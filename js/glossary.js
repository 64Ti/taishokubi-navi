/**
 * glossary.js
 * 「トク退」用語ミニ解説データ（出典: 用語ミニ解説 v1.0／仕様書 第14.1節 第3層）
 *
 * short: ポップオーバーに表示する20〜40字の要約（断定を避ける文体）
 * detail: 補足説明
 * relatedFaq: 第2層FAQのID（「詳しく見る→」の遷移先。ない場合はnull）
 *
 * ⚠️ 原本ドキュメントのヘッダには「収録語数24語」と記載されているが、
 *    実際に収録されている用語数は26語（本ファイルもそれに合わせて26語を実装）。
 *    件数表記の誤りはコンテンツ側の軽微な不整合であり、用語自体は全件有効なため
 *    削らずそのまま実装している。
 *
 * window.TokutaiGlossary として公開。
 */
(function (global) {
  'use strict';

  const GLOSSARY = {
    // ---- カテゴリA：社会保険 ----
    shikaku_soushitsu_bi: {
      term: '資格喪失日',
      short: '退職日の翌日のことです。この日から、会社の健康保険が使えなくなります。',
      detail: '3月31日に退職した場合、資格喪失日は4月1日です。退職日当日ではない点にご注意ください。',
      relatedFaq: 'q_loss_date',
    },
    hyojun_hoshu_getsugaku: {
      term: '標準報酬月額',
      short: '社会保険料を計算するために、給与を区切りのよい金額に当てはめたものです。',
      detail: '実際の給与そのものではなく、等級表に当てはめた金額で保険料が決まります。',
      relatedFaq: null,
    },
    nini_keizoku: {
      term: '任意継続（任意継続被保険者）',
      short: '退職後も、会社の健康保険に最長2年間そのまま加入し続けられる制度です。',
      detail: '保険料は全額自己負担になりますが上限があり、扶養家族が何人いても金額は変わりません。申請は資格喪失日から20日以内です。',
      relatedFaq: 'q_kokuho_vs_nini',
    },
    shikaku_kakunin_sho: {
      term: '資格確認書',
      short: 'マイナ保険証を使わない方に交付される、健康保険の加入を証明する紙の書類です。',
      detail: '2026年8月1日以降、受診にはマイナ保険証かこの資格確認書が必要です。退職日の翌日以降は使えません。',
      relatedFaq: 'q_insurance_card',
    },
    myna_hokensho: {
      term: 'マイナ保険証',
      short: 'マイナンバーカードを健康保険証として使えるように登録したものです。',
      detail: 'カード自体は退職時に返却不要です。次の健康保険に加入すれば、同じカードをそのまま使えます。',
      relatedFaq: 'q_insurance_card',
    },
    daisan_go: {
      term: '国民年金第3号被保険者',
      short: '会社員などに扶養されている配偶者のことで、国民年金保険料の負担がありません。',
      detail: '20歳以上60歳未満の配偶者が対象です。扶養から外れると第1号被保険者となり、保険料の納付が必要になります。',
      relatedFaq: 'q_fuyou_condition',
    },
    doujitsu_tokusou: {
      term: '同日得喪',
      short: '定年後の再雇用などで、資格喪失と取得を同じ日に行い保険料を早く下げる手続きです。',
      detail: '給与が下がった場合、通常なら反映まで数か月かかる保険料を、翌月から新しい給与に合わせられます。',
      relatedFaq: null,
    },
    kaigo_hoken_2go: {
      term: '介護保険第2号被保険者',
      short: '40歳から64歳までの方のことで、健康保険料に介護保険料が上乗せされます。',
      detail: '令和8年度の介護保険料率は全国一律1.62%（本人負担0.81%）です。65歳からは納め方が変わります。',
      relatedFaq: null,
    },

    // ---- カテゴリB：雇用保険 ----
    kihon_teate: {
      term: '基本手当（失業保険）',
      short: '失業中の生活を支えるために、ハローワークから支給されるお金のことです。',
      detail: '働く意思と能力があり、求職活動をしていることが条件です。療養中で働けない場合は対象になりません。',
      relatedFaq: 'q_when_benefit',
    },
    taiki_kikan: {
      term: '待期期間',
      short: 'ハローワークで手続きをした後、支給が始まるまでの7日間のことです。',
      detail: '退職日からではなく、ハローワークで求職の申し込みをした日から数えます。行くのが遅れると支給開始も遅れます。',
      relatedFaq: 'q_when_benefit',
    },
    kyufu_seigen: {
      term: '給付制限',
      short: '自己都合で退職した場合に、待期の後さらに支給を待つ期間のことです。',
      detail: '2025年4月1日以降の退職は原則1か月です（それ以前は2か月）。5年以内に3回以上だと3か月になります。',
      relatedFaq: 'q_when_benefit',
    },
    tokutei_juky_shikaku_sha: {
      term: '特定受給資格者',
      short: '倒産や解雇など、会社側の事情で退職せざるを得なかった方のことです。',
      detail: '給付制限がなく、支給される日数も長くなります。国民健康保険料の軽減措置の対象にもなります。',
      relatedFaq: 'q_company_vs_self',
    },
    tokutei_riyu_rishoku_sha: {
      term: '特定理由離職者',
      short: '雇止めや体調不良など、正当な理由があって退職した方のことです。',
      detail: '認められると給付制限がなくなり、受給に必要な加入期間も短くなります。判断するのはハローワークです。',
      relatedFaq: 'q_specific_reason',
    },
    shotei_kyufu_nissu: {
      term: '所定給付日数',
      short: '失業保険を受け取れる日数のことで、年齢と加入期間によって決まります。',
      detail: '自己都合は最大150日、会社都合の場合は最大330日です。受給期間を延長しても、この日数自体は増えません。',
      relatedFaq: 'q_company_vs_self',
    },
    rishoku_hyo: {
      term: '離職票',
      short: '失業保険の手続きに必要な書類で、退職後に会社から送られてきます。',
      detail: '手元に届くまで退職後10日から2週間程度かかります。離職理由が記載されるため、必ず内容を確認してください。',
      relatedFaq: 'q_rikyokuhyo_late',
    },
    jukyu_kikan_encho: {
      term: '受給期間延長',
      short: '療養などで働けない間、失業保険を受け取れる期間を先送りする手続きです。',
      detail: '30日以上働けない状態が続く場合、最大3年間（合計最大4年）延長できます。早めの申請が安全です。',
      relatedFaq: 'q_both_benefits',
    },
    saishushoku_teate: {
      term: '再就職手当',
      short: '失業保険の受給中に早く再就職や開業をした方に支給されるお金です。',
      detail: '給付制限の期間中に自分で事業を始めた場合は対象外となるため、開業のタイミングに注意が必要です。',
      relatedFaq: 'q_opening_notice',
    },

    // ---- カテゴリC：健康保険の給付 ----
    shobyo_teate_kin: {
      term: '傷病手当金',
      short: '病気やけがで働けないときに、健康保険から支給されるお金のことです。',
      detail: '支給開始から通算1年6か月まで受け取れます。退職後も続けて受けるには、継続1年以上の加入が必要です。',
      relatedFaq: 'q_sickness_allowance',
    },
    roumu_funo: {
      term: '労務不能',
      short: '病気やけがのために、これまでの仕事ができない状態のことです。',
      detail: '傷病手当金を受け取る条件です。退職日に出勤すると、この状態ではなかったと判断される場合があります。',
      relatedFaq: 'q_last_day_attendance',
    },

    // ---- カテゴリD：税金 ----
    taishoku_shotoku_kojo: {
      term: '退職所得控除',
      short: '退職金にかかる税金を大きく減らしてくれる、金額の大きな控除のことです。',
      detail: '勤続20年以下は1年あたり40万円、20年を超える部分は1年あたり70万円です。勤続年数は1年未満を切り上げます。',
      relatedFaq: 'q_retirement_tax',
    },
    tokubetsu_choshu: {
      term: '特別徴収（住民税）',
      short: '住民税を毎月の給与から天引きで納める方法のことです。',
      detail: '6月から翌年5月までの12回に分けて納めます。退職すると天引きができなくなるため、納め方が変わります。',
      relatedFaq: 'q_resident_tax',
    },
    futsu_choshu: {
      term: '普通徴収（住民税）',
      short: '自宅に届く納付書を使って、住民税を自分で納める方法のことです。',
      detail: '6月から12月に退職した場合は、原則としてこちらに切り替わります。年4回に分けて納めるのが一般的です。',
      relatedFaq: 'q_resident_tax',
    },

    // ---- カテゴリE：年金・その他 ----
    kigyogata_dc: {
      term: '企業型DC（企業型確定拠出年金）',
      short: '会社が掛金を出し、加入者が自分で運用する年金制度のことです。',
      detail: '退職後6か月以内に移す手続きが必要です。放置すると運用が止まり、手数料だけが引かれ続けます。',
      relatedFaq: 'q_corporate_dc',
    },
    jido_ikan: {
      term: '自動移換',
      short: '企業型DCを6か月放置すると、資産が自動的に別の場所へ移されることです。',
      detail: '運用が止まったまま手数料が引かれ続け、その期間は加入者期間に数えられません。受給開始が遅れる場合があります。',
      relatedFaq: 'q_corporate_dc',
    },
    jiki_henko_ken: {
      term: '時季変更権',
      short: '会社が有給の取得時期をずらしてもらえる権利のことです。',
      detail: '別の日に振り替えることが前提のため、退職前の有給消化では実質的に使えません。',
      relatedFaq: 'q_paid_leave_refused',
    },
    shikyubi_zaiseki_yoken: {
      term: '支給日在籍要件',
      short: '賞与を受け取るには、支給日に会社に在籍している必要があるという決まりです。',
      detail: '法律ではなく会社の規程で定められます。定めがあるかどうかは賃金規程で確認できます。',
      relatedFaq: 'q_bonus_timing',
    },
  };

  function getTerm(id) {
    return GLOSSARY[id] || null;
  }

  global.TokutaiGlossary = {
    GLOSSARY,
    getTerm,
  };
})(window);
