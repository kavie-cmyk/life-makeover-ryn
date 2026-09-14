/* Cross-view item detail bindings for Ryn Wardrobe Lab. */
(() => {
  function findInventoryEntry(id) {
    return [...document.querySelectorAll("#view-inventory [data-view-item]")]
      .find(el => el.dataset.viewItem === id) || null;
  }

  function openViaInventory(id) {
    if (!id) return;
    let entry = findInventoryEntry(id);
    if (!entry && typeof renderInventory === "function") {
      renderInventory();
      entry = findInventoryEntry(id);
    }
    if (entry) entry.click();
  }

  function makeClickable(el, item) {
    if (!el || !item?.id || el.dataset.detailBound === "1") return;
    el.dataset.detailBound = "1";
    el.dataset.detailItemId = item.id;
    el.classList.add("cross-detail-item");
    if (!el.hasAttribute("tabindex")) el.tabIndex = 0;
    if (!el.hasAttribute("role")) el.setAttribute("role", "button");
    el.setAttribute("aria-label", `Xem chi tiết ${item.name}`);

    el.addEventListener("click", e => {
      if (e.target.closest("button,a,input,select,label")) return;
      openViaInventory(item.id);
    });
    el.addEventListener("keydown", e => {
      if (e.key !== "Enter" && e.key !== " ") return;
      if (e.target.closest("button,a,input,select,label")) return;
      e.preventDefault();
      openViaInventory(item.id);
    });
  }

  function bindByOrder(selector, itemList) {
    const nodes = [...document.querySelectorAll(selector)];
    nodes.forEach((node, index) => makeClickable(node, itemList[index]));
  }

  function decorateDashboard() {
    const best = bestStyleSummary();
    const upgrades = STYLES
      .flatMap(style => candidateRanking(style).filter(x => x.gain > 0).slice(0, 1).map(x => ({ ...x, style })))
      .sort((a, b) => b.gain - a.gain)
      .slice(0, 3);

    if (upgrades.length) {
      bindByOrder("#upgradePreview .upgrade-row", upgrades.map(x => x.candidate));
    } else {
      const style = best.total ? best.style : "Cool";
      bindByOrder("#upgradePreview .upgrade-row", fallbackWeakSlots(style).slice(0, 3).map(x => x.item));
    }
  }

  function decorateOptimizer() {
    const outfit = bestOutfit(activeOptimizerStyle);
    bindByOrder("#outfitList .outfit-item", outfit.selected);

    const ranking = candidateRanking(activeOptimizerStyle).filter(x => x.gain > 0);
    const good = document.querySelector("#optimizerInsights .insight-card.good");
    if (good && ranking[0]) makeClickable(good, ranking[0].candidate);

    const weak = fallbackWeakSlots(activeOptimizerStyle).slice(0, 4).map(x => x.item);
    bindByOrder("#optimizerInsights .insight-card.warn", weak);
  }

  function decorateTargets() {
    const ranking = candidateRanking(activeTargetStyle);
    const positive = ranking.filter(x => x.gain > 0);

    if (positive.length) {
      makeClickable(document.querySelector("#targetHero .target-hero"), positive[0].candidate);
      bindByOrder("#targetList .target-row", positive.map(x => x.candidate));
    } else {
      bindByOrder("#targetList .target-row", ranking.slice(0, 8).map(x => x.candidate));
    }

    bindByOrder("#fallbackTargetPanel .upgrade-row", fallbackWeakSlots(activeTargetStyle).map(x => x.item));
  }

  const baseDashboard = renderDashboard;
  renderDashboard = function(...args) {
    const result = baseDashboard.apply(this, args);
    decorateDashboard();
    return result;
  };

  const baseOptimizer = renderOptimizer;
  renderOptimizer = function(...args) {
    const result = baseOptimizer.apply(this, args);
    decorateOptimizer();
    return result;
  };

  const baseTargets = renderTargets;
  renderTargets = function(...args) {
    const result = baseTargets.apply(this, args);
    decorateTargets();
    return result;
  };

  const style = document.createElement("style");
  style.textContent = `
    .cross-detail-item{cursor:pointer;transition:background .16s ease,border-color .16s ease,transform .16s ease}
    .cross-detail-item:hover{background:#faf8ff}
    .cross-detail-item:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
    .outfit-item.cross-detail-item:hover,.target-row.cross-detail-item:hover,.upgrade-row.cross-detail-item:hover{background:#faf8ff}
    .insight-card.cross-detail-item:hover{border-color:#cfc1df;transform:translateY(-1px)}
    .target-hero.cross-detail-item:hover{border-color:#c8b7e7}
    @media(max-width:760px){.cross-detail-item:active{transform:scale(.995)}}
  `;
  document.head.appendChild(style);

  renderDashboard();
  renderOptimizer();
  renderTargets();
})();
