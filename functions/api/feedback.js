/**
 * functions/api/feedback.js
 * フィードバック送信 Phase 2（Cloudflare Pages Functions + KV）
 * 出典: 仕様書 v17.2 第13.2節／フィードバックフォーム設計書 v1.0 第7章
 *
 * ⚠️ デプロイ前提条件（サイト運営者作業）：
 *   Cloudflare Pages ダッシュボードで KV Namespace を作成し、
 *   このプロジェクトに `FEEDBACK_KV` という名前でバインドすること。
 *   バインドされていない環境（ローカル file:// でのテスト等）では、
 *   本エンドポイント自体が存在しないため、js/feedback.js 側の fetch は
 *   ネットワークエラーとして握りつぶされ、Phase1（Googleフォーム）の動作は妨げられない。
 *
 * プライバシー方針：
 *   - IPアドレスは生のまま保存しない。レート制限にのみハッシュ化して使用する。
 *   - 送信内容に要配慮情報（体調不調フラグ等）・氏名・連絡先が含まれていないかを検証する。
 */

const RATE_LIMIT_PER_HOUR = 10;
const MAX_FREE_TEXT_LENGTH = 1000;
const FORBIDDEN_KEYS = ['isMentalPhysicalUnfit', 'birthDate', 'birthYear', 'retirementPayAmount', 'bonusAmount', 'annualIncome'];
const VALID_CATEGORIES = ['calc_mismatch', 'content_error', 'usability', 'feature_request', 'praise', 'praise_quick'];
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

async function hashIp(ip) {
  const data = new TextEncoder().encode('tokutai-fb-salt:' + ip);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function containsForbiddenKey(payload) {
  const text = JSON.stringify(payload);
  return FORBIDDEN_KEYS.some(k => text.includes(k));
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.FEEDBACK_KV) {
    // KV未バインド環境（デプロイ設定不備）。500ではなく503で「一時的に利用不可」を返す。
    return json(503, { ok: false, error: 'feedback_storage_unavailable' });
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json(400, { ok: false, error: 'invalid_json' });
  }

  const category = String(body.category || '');
  if (!VALID_CATEGORIES.includes(category)) {
    return json(400, { ok: false, error: 'invalid_category' });
  }

  const freeText = String(body.freeText || '').slice(0, MAX_FREE_TEXT_LENGTH);
  const contextSummary = String(body.context || '').slice(0, 500);

  if (containsForbiddenKey({ category, freeText, context: contextSummary })) {
    return json(400, { ok: false, error: 'sensitive_data_detected' });
  }

  // ---- レート制限（同一IPから1時間10件まで。IPは保存せずハッシュのみ使用）----
  const rawIp = request.headers.get('CF-Connecting-IP') || '0.0.0.0';
  const ipHash = await hashIp(rawIp);
  const hourBucket = Math.floor(Date.now() / (60 * 60 * 1000));
  const rateLimitKey = `ratelimit:${ipHash}:${hourBucket}`;

  const currentCountRaw = await env.FEEDBACK_KV.get(rateLimitKey);
  const currentCount = currentCountRaw ? parseInt(currentCountRaw, 10) : 0;
  if (currentCount >= RATE_LIMIT_PER_HOUR) {
    return json(429, { ok: false, error: 'rate_limited' });
  }
  await env.FEEDBACK_KV.put(rateLimitKey, String(currentCount + 1), { expirationTtl: 3600 });

  // ---- 保存 ----
  const id = crypto.randomUUID();
  const record = {
    category,
    freeText,
    context: contextSummary,
    createdAt: new Date().toISOString(),
  };
  await env.FEEDBACK_KV.put(`fb:${Date.now()}:${id}`, JSON.stringify(record), {
    expirationTtl: ONE_YEAR_SECONDS,
  });

  return json(200, { ok: true });
}

// GET等その他のメソッドは許可しない
export async function onRequestGet() {
  return json(405, { ok: false, error: 'method_not_allowed' });
}
