/* Weakest-first upgrade recommendation for Ryn Wardrobe Lab.
 * Policy:
 * 1) Improve the lowest-scoring style first.
 * 2) Prefer permanent/free/grindable acquisition over limited/gacha.
 * 3) Recommend an exact saved target when available; otherwise output a hunt brief
 *    with style + slot + rarity + minimum score to beat.
 */
(() => {
  let targetStyleManuallyChanged = false;
  const originalCandidateRanking = candidateRanking;

  const PERMANENT_FREE = [
    "story", "chapter", "mind travel", "endorsement", "fashion battle", "guild",
    "craft", "recipe", "exchange", "decom", "decomposition", "achievement",
    "mission", "daily", "sign-in", "signin", "login", "collection", "permanent",
    "shop exchange", "store exchange"
  ];
  const EVENTISH = ["event", "reward", "styling wizard"];
  const LIMITED_PAID = [
    "time-limited", "time limited", "limited lightchase", "lightchase", "top-up",
    "top up", "rebate", "fashion code", "purchase", "paid", "wonder box"
  ];

  function sourceText(item) {
    return `${item?.source || ""} ${item?.wiki?.source || ""}`.trim().toLowerCase();
  }

  function availability(item) {
    const src = sourceText(item);
    if (!src) return { tier: 1, label: "Chưa rõ nguồn", cls: "unknown", reason: "Cần kiểm tra cách lấy" };
    if (LIMITED_PAID.some(k => src.includes(k))) {
      return { tier: 0, label: "Limited / gacha", cls: "limited", reason: "Hạ ưu tiên vì không phải nguồn cày ổn định" };
    }
    if (PERMANENT_FREE.some(k => src.includes(k))) {
      return { tier: 3, label: "Free / cày lâu dài", cls: "free", reason: "Ưu tiên vì có dấu hiệu là nguồn permanent / exchange / grind" };
    }
    if (EVENTISH.some(k => src.includes(k))) {
      return { tier: 2, label: "Event / reward", cls: "event", reason: "Có thể free nhưng cần kiểm tra event còn mở" };
    }
    return { tier: 1, label: "Chưa rõ nguồn", cls: "unknown", reason: "Không đủ dữ liệu để xác nhận free/permanent" };
  }

  // Within any one style, free/permanent candidates come first, then gain.
  candidateRanking = function(style) {
    return originalCandidateRanking(style).sort((a, b) => {
      const aa = availability(a.candidate);
      const bb = availability(b.candidate);
      if (bb.tier !== aa.tier) return bb.tier - aa.tier;
      if (b.gain !== a.gain) return b.gain - a.gain;
      if (b.candidate.rarity !== a.candidate.rarity) return b.candidate.rarity - a.candidate.rarity;
      return getScore(b.candidate, style) - getScore(a.candidate, style);
    });
  };

  function styleStrengths() {
    return STYLES.map(style => {
      const outfit = bestOutfit(style);
      return { style, total: outfit.total, pieces: outfit.selected.length, outfit };
    }).sort((a, b) => a.total - b.total || a.pieces - b.pieces || a.style.localeCompare(b.style));
  }

  function weakestStyle() {
    return styleStrengths()[0] || { style: "Cool", total: 0, pieces: 0, outfit: bestOutfit("Cool") };
  }

  function nextRarity(currentRarity, missing = false) {
    if (missing || !currentRarity) return 5;
    if (currentRarity <= 4) return 5;
    return 6;
  }

  function huntBrief(style) {
    const out = bestOutfit(style);

    // In EQ/Fashion Battle, filling the five counted accessory spots is usually the
    // cleanest immediate gain because the new item contributes its full score.
    if (activeScoreMode === "eq" && out.countedAccessories.length < 5) {
      return {
        style,
        slot: "Accessory mới",
        rarity: 5,
        idealRarity: 6,
        threshold: 0,
        current: null,
        reason: `Best set mới có ${out.countedAccessories.length}/5 accessory được tính điểm`,
        rule: "Tìm accessory có thuộc tính này; ưu tiên 5★ free/cày, 6★ nếu có nguồn permanent."
      };
    }

    const clothing = out.selected
      .filter(item => !isAccessory(item))
      .map(item => ({ item, score: getScore(item, style) }))
      .sort((a, b) => a.item.rarity - b.item.rarity || a.score - b.score);

    // Fix a low-rarity main piece before replacing already-strong 6★ pieces.
    const lowRarity = clothing.find(x => x.item.rarity < 6);
    if (lowRarity) {
      return {
        style,
        slot: lowRarity.item.type,
        rarity: nextRarity(lowRarity.item.rarity),
        idealRarity: 6,
        threshold: lowRarity.score,
        current: lowRarity.item,
        reason: `${lowRarity.item.name} mới ${lowRarity.item.rarity}★ trong best set ${style}`,
        rule: `Món mới phải vượt ${nice(lowRarity.score)} điểm ${style} của món hiện tại.`
      };
    }

    if (activeScoreMode === "eq" && out.countedAccessories.length) {
      const weakestAcc = [...out.countedAccessories]
        .sort((a, b) => getScore(a, style) - getScore(b, style))[0];
      const threshold = getScore(weakestAcc, style);
      return {
        style,
        slot: "Accessory",
        rarity: nextRarity(weakestAcc.rarity),
        idealRarity: 6,
        threshold,
        current: weakestAcc,
        reason: `${weakestAcc.name} đang là mốc thấp nhất trong top 5 accessory`,
        rule: `Accessory mới cần > ${nice(threshold)} điểm ${style} để chen vào top 5.`
      };
    }

    if (clothing.length) {
      const weakest = [...clothing].sort((a, b) => a.score - b.score)[0];
      return {
        style,
        slot: weakest.item.type,
        rarity: 6,
        idealRarity: 6,
        threshold: weakest.score,
        current: weakest.item,
        reason: `${weakest.item.name} là món main có điểm ${style} thấp nhất`,
        rule: `Tìm 6★ có điểm ${style} > ${nice(weakest.score)}.`
      };
    }

    return {
      style,
      slot: "Dress / main piece",
      rarity: 5,
      idealRarity: 6,
      threshold: 0,
      current: null,
      reason: `Chưa có món nào đóng góp điểm ${style}`,
      rule: "Bắt đầu bằng 5★ free/cày; nâng lên 6★ permanent khi có."
    };
  }

  function exactFreeCandidate(style) {
    const positive = candidateRanking(style).filter(x => x.gain > 0);
    const preferred = positive.find(x => availability(x.candidate).tier >= 2);
    return preferred || null;
  }

  function nice(n) {
    const x = Number(n || 0);
    return Number.isInteger(x) ? String(x) : x.toFixed(1);
  }

  function sourceLabel(item) {
    const a = availability(item);
    return `<span class="obtain-badge ${a.cls}">${a.label}</span>`;
  }

  function queueHtml(strengths) {
    return strengths.slice(0, 3).map((row, index) =>
      `<div class="weak-queue-row"><span>#${index + 1}</span><strong>${row.style}</strong><b>${nice(row.total)}</b></div>`
    ).join("");
  }

  function openDetailById(id) {
    if (!id) return;
    let entry = [...document.querySelectorAll("#view-inventory [data-view-item]")]
      .find(el => el.dataset.viewItem === id);
    if (!entry && typeof renderInventory === "function") {
      renderInventory();
      entry = [...document.querySelectorAll("#view-inventory [data-view-item]")]
        .find(el => el.dataset.viewItem === id);
    }
    if (entry) entry.click();
  }

  function bindExactCandidate(root) {
    root?.querySelectorAll("[data-recommend-item]").forEach(el => {
      if (el.dataset.recommendBound === "1") return;
      el.dataset.recommendBound = "1";
      el.tabIndex = 0;
      el.setAttribute("role", "button");
      el.addEventListener("click", e => {
        if (e.target.closest("a,button,input,select,label")) return;
        openDetailById(el.dataset.recommendItem);
      });
      el.addEventListener("keydown", e => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openDetailById(el.dataset.recommendItem);
        }
      });
    });
  }

  function priorityCardHtml(compact = false) {
    const strengths = styleStrengths();
    const weak = strengths[0];
    const strong = strengths[strengths.length - 1];
    const gap = Math.max(0, strong.total - weak.total);
    const brief = huntBrief(weak.style);
    const exact = exactFreeCandidate(weak.style);

    const exactHtml = exact ? (() => {
      const a = availability(exact.candidate);
      return `<div class="exact-hunt" data-recommend-item="${esc(exact.candidate.id)}">
        <div><span class="recommend-mini">CANDIDATE PHÙ HỢP ĐÃ LƯU</span><strong>${esc(exact.candidate.name)}</strong><small>${esc(exact.candidate.type)} · ${exact.candidate.rarity}★ · +${nice(exact.gain)} điểm ${weak.style}</small></div>
        <div>${sourceLabel(exact.candidate)}</div>
        <p>${esc(exact.candidate.source || exact.candidate.wiki?.source || a.reason)}</p>
      </div>`;
    })() : `<div class="free-source-note"><strong>Ưu tiên nguồn free / cày còn dùng lâu dài</strong><p>Story/Chapter · Mind Travel · Endorsement/Fashion Battle · Guild · Exchange/Shop currency · Craft/Recipe · Achievement. Hạ ưu tiên Lightchase limited, top-up và nguồn paid.</p></div>`;

    return `<div class="weakest-recommend ${compact ? "compact" : ""}">
      <div class="weakest-head">
        <div><span class="recommend-mini">ƯU TIÊN #1 · WEAKEST FIRST</span><h3>${weak.style}</h3><p>Đây là thuộc tính thấp nhất hiện tại: <b>${nice(weak.total)}</b>${gap ? ` · kém thuộc tính mạnh nhất ${nice(gap)}` : ""}.</p></div>
        <div class="weak-rank">${queueHtml(strengths)}</div>
      </div>
      <div class="hunt-spec-grid">
        <div><span>Thuộc tính cần tăng</span><strong>${weak.style}</strong></div>
        <div><span>Slot nên tìm</span><strong>${esc(brief.slot)}</strong></div>
        <div><span>Rarity mục tiêu</span><strong>${brief.rarity}★${brief.idealRarity > brief.rarity ? ` → ideal ${brief.idealRarity}★` : ""}</strong></div>
        <div><span>Mốc cần vượt</span><strong>${brief.threshold > 0 ? `> ${nice(brief.threshold)}` : "Có điểm > 0"}</strong></div>
      </div>
      <div class="hunt-reason"><strong>${esc(brief.reason)}</strong><p>${esc(brief.rule)}</p></div>
      ${exactHtml}
    </div>`;
  }

  function decorateTargetAvailability() {
    const ranking = candidateRanking(activeTargetStyle);
    const rows = [...document.querySelectorAll("#targetList .target-row")];
    const data = ranking.filter(x => x.gain > 0).length ? ranking.filter(x => x.gain > 0) : ranking.slice(0, 8);
    rows.forEach((row, index) => {
      const sim = data[index];
      if (!sim || row.querySelector(".obtain-badge")) return;
      const holder = row.querySelector("div:nth-child(2)");
      if (holder) holder.insertAdjacentHTML("beforeend", sourceLabel(sim.candidate));
    });
  }

  function renderUpgradePriority() {
    const preview = $("upgradePreview");
    if (!preview) return;
    preview.innerHTML = priorityCardHtml(true);
    const panel = preview.closest(".panel");
    const title = panel?.querySelector(".panel-head h3");
    const eyebrow = panel?.querySelector(".panel-head .eyebrow");
    if (title) title.textContent = "Nâng thuộc tính yếu nhất trước";
    if (eyebrow) eyebrow.textContent = "UPGRADE PRIORITY";
    bindExactCandidate(preview);
  }

  function renderGlobalTargetPriority() {
    const hero = $("targetHero");
    if (!hero) return;
    let panel = $("weakestFirstTarget");
    if (!panel) {
      panel = document.createElement("div");
      panel.id = "weakestFirstTarget";
      hero.parentNode.insertBefore(panel, hero);
    }
    panel.innerHTML = priorityCardHtml(false);
    bindExactCandidate(panel);
    decorateTargetAvailability();
  }

  const baseDashboard = renderDashboard;
  renderDashboard = function(...args) {
    const result = baseDashboard.apply(this, args);
    renderUpgradePriority();
    return result;
  };

  const baseTargets = renderTargets;
  renderTargets = function(...args) {
    const weak = weakestStyle();
    if (!targetStyleManuallyChanged && weak?.style) activeTargetStyle = weak.style;
    const result = baseTargets.apply(this, args);
    if ($("targetStyle")) $("targetStyle").value = activeTargetStyle;
    renderGlobalTargetPriority();
    return result;
  };

  $("targetStyle")?.addEventListener("change", () => { targetStyleManuallyChanged = true; });

  const style = document.createElement("style");
  style.textContent = `
    .weakest-recommend{border:1px solid #d9ccef;background:linear-gradient(135deg,#f7f3ff,#fff);border-radius:20px;padding:17px;margin-bottom:16px}.weakest-recommend.compact{border:0;background:transparent;padding:0;margin:0}.weakest-head{display:grid;grid-template-columns:1fr auto;gap:14px;align-items:start}.recommend-mini{display:block;font-size:9px;letter-spacing:.11em;font-weight:850;color:var(--accent);margin-bottom:4px}.weakest-head h3{font-size:24px;margin:0 0 4px}.weakest-head p{font-size:10px;color:var(--muted);margin:0;line-height:1.5}.weak-rank{display:grid;gap:4px;min-width:130px}.weak-queue-row{display:grid;grid-template-columns:22px 1fr auto;gap:6px;align-items:center;font-size:9px;background:#fff;border:1px solid #e8e0f1;border-radius:9px;padding:5px 7px}.weak-queue-row span{color:var(--muted)}.weak-queue-row b{font-size:10px}.hunt-spec-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-top:13px}.hunt-spec-grid>div{background:#fff;border:1px solid #e6ddf0;border-radius:12px;padding:10px}.hunt-spec-grid span{display:block;font-size:8px;color:var(--muted);margin-bottom:4px}.hunt-spec-grid strong{display:block;font-size:12px}.hunt-reason{margin-top:10px;padding:10px 11px;border-radius:12px;background:#f0ebff}.hunt-reason strong{font-size:11px}.hunt-reason p,.free-source-note p,.exact-hunt p{font-size:9px;line-height:1.5;color:var(--muted);margin:4px 0 0}.free-source-note,.exact-hunt{margin-top:9px;border:1px solid #dfe9df;background:#f8fcf8;border-radius:12px;padding:10px 11px}.free-source-note strong,.exact-hunt strong{font-size:11px}.exact-hunt{cursor:pointer;display:grid;grid-template-columns:1fr auto;gap:8px}.exact-hunt>p{grid-column:1/-1}.exact-hunt small{display:block;color:var(--muted);font-size:9px;margin-top:3px}.obtain-badge{display:inline-flex;width:max-content;margin-top:5px;border-radius:999px;padding:3px 6px;font-size:8px;font-weight:850}.obtain-badge.free{background:#e7f7e9;color:#327044}.obtain-badge.event{background:#fff4d8;color:#8a6917}.obtain-badge.unknown{background:#f0edf3;color:#746a7e}.obtain-badge.limited{background:#fde9ee;color:#9b4056}.target-row .obtain-badge{margin-left:0}.exact-hunt:hover{border-color:#b9d6be;background:#f2faf3}
    @media(max-width:760px){.weakest-head{grid-template-columns:1fr}.weak-rank{grid-template-columns:repeat(3,1fr);min-width:0}.weak-queue-row{grid-template-columns:18px 1fr;gap:3px}.weak-queue-row b{grid-column:2}.hunt-spec-grid{grid-template-columns:1fr 1fr}.weakest-recommend{border-radius:16px;padding:14px}.weakest-recommend.compact{padding:0}.exact-hunt{grid-template-columns:1fr}.exact-hunt>p{grid-column:auto}}
  `;
  document.head.appendChild(style);

  renderDashboard();
  renderTargets();
})();
