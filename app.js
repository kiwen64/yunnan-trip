(function () {
  const STORAGE_KEY = "yunnan-trip-v5-food-stays";
  const PACKING_KEY = "yunnan-packing-checked-v1";
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const clone = (value) => JSON.parse(JSON.stringify(value));

  let trip = loadTrip();
  let activeDayIndex = 0;
  let activeSpotId = null;
  let map;
  let routeLayer;
  let markerLayer;
  let userLayer;
  let markers = new Map();
  let editorContext = null;
  let packingChecked = loadPackingChecked();

  function loadTrip() {
    try {
      const hash = new URLSearchParams(location.hash.slice(1)).get("trip");
      if (hash) {
        const shared = JSON.parse(decodeURIComponent(escape(atob(hash))));
        localStorage.setItem(STORAGE_KEY, JSON.stringify(shared));
        history.replaceState(null, "", location.pathname + location.search);
        return shared;
      }
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || clone(window.DEFAULT_TRIP);
    } catch (error) {
      console.warn("行程读取失败，已载入默认数据", error);
      return clone(window.DEFAULT_TRIP);
    }
  }

  function saveTrip(message = "已保存") {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trip));
    renderAll();
    toast(message);
  }

  function init() {
    renderAll();
    initMap();
    bindEvents();
    switchMobileView("map");
    if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    }
  }

  function renderAll() {
    renderHeader();
    renderTabs();
    renderDay();
    renderNotices();
    if (map) renderMap();
  }

  function renderHeader() {
    $("#tripTitle").textContent = trip.title;
    $("#tripSubtitle").textContent = trip.subtitle;
    const cities = [...new Set(trip.days.flatMap(day => day.city.split("→").map(city => city.trim())))].join(" · ");
    const dateText = trip.startDate ? formatRange(trip.startDate, trip.days.length) : "日期待定";
    $("#tripOverview").innerHTML = `
      <div class="overview-item"><span>TRIP LENGTH</span><strong>${trip.days.length} 天</strong></div>
      <div class="overview-item"><span>DESTINATIONS</span><strong>${cities}</strong></div>
      <div class="overview-item"><span>DATE & PARTY</span><strong>${dateText} · ${escapeHtml(trip.companions)}</strong></div>`;
  }

  function renderTabs() {
    $("#dayTabs").innerHTML = trip.days.map((day, index) => `
      <button class="day-tab ${index === activeDayIndex ? "active" : ""}" data-day-index="${index}">
        <span>DAY ${String(index + 1).padStart(2, "0")}</span><small>${escapeHtml(day.city)} · ${dayDate(index)}</small>
      </button>`).join("");
  }

  function renderDay() {
    const day = trip.days[activeDayIndex];
    if (!day) return;
    $("#dayKicker").textContent = `DAY ${String(activeDayIndex + 1).padStart(2, "0")} · ${dayDate(activeDayIndex)}`;
    $("#dayTitle").textContent = day.title;
    $("#daySummary").textContent = day.summary;
    const spots = visibleSpots(day).map((spot, index) => timelineCard(spot, index)).join("");
    const stay = day.stay ? `
      <article class="timeline-item" data-stay="true">
        <time class="time-label">夜宿</time><i class="timeline-dot" style="background:${day.color}"></i>
        <div class="spot-card stay-card" data-action="open-stay">
          <div><h3>⌂ ${escapeHtml(day.stay.name)}</h3><p>${escapeHtml(day.stay.address)}</p><div class="spot-meta"><span class="chip">住宿建议</span><span class="chip">${day.stay.options?.length || 0} 个有依据的选择</span><span class="chip">查看预订提醒</span></div></div><span class="spot-arrow">→</span>
        </div>
      </article>` : "";
    $("#timeline").innerHTML = spots + stay + `
      <article class="timeline-item add-item"><time class="time-label"></time><i class="timeline-dot"></i>
        <button class="spot-card" data-action="add-spot"><div><h3>＋ 添加一个地点</h3><p>继续完善这一天的路线</p></div></button>
      </article>`;
  }

  function timelineCard(spot, index) {
    return `<article class="timeline-item" data-spot-id="${spot.id}">
      <time class="time-label">${escapeHtml(spot.time)}</time><i class="timeline-dot"></i>
      <div class="spot-card ${isFoodSpot(spot) ? "food-card" : ""}">
        <div><h3>${String(index + 1).padStart(2, "0")} · ${escapeHtml(spot.name)}</h3><p>${escapeHtml(spot.description)}</p>
          <div class="spot-meta"><span class="chip">${escapeHtml(spot.type)}</span><span class="chip">${escapeHtml(spot.duration)}</span><span class="chip">${escapeHtml(spot.transport.split("；")[0])}</span></div>
        </div><span class="spot-arrow">→</span>
      </div>
    </article>`;
  }

  function renderNotices() {
    $("#noticeGrid").innerHTML = trip.notes.map(note => `<article class="notice-card"><span class="notice-icon">${escapeHtml(note.icon)}</span><h3>${escapeHtml(note.title)}</h3><p>${escapeHtml(note.body)}</p></article>`).join("");
    renderPacking();
  }

  function loadPackingChecked() {
    try { return new Set(JSON.parse(localStorage.getItem(PACKING_KEY)) || []); }
    catch (error) { return new Set(); }
  }

  function packingCategories() {
    return Array.isArray(trip.packing) && trip.packing.length ? trip.packing : (window.DEFAULT_TRIP.packing || []);
  }

  function renderPacking() {
    const categories = packingCategories();
    const items = categories.flatMap(category => category.items);
    const validIds = new Set(items.map(item => item.id));
    packingChecked = new Set([...packingChecked].filter(id => validIds.has(id)));
    const completed = items.filter(item => packingChecked.has(item.id)).length;
    const percent = items.length ? Math.round(completed / items.length * 100) : 0;
    $("#packingProgressText").textContent = `${completed} / ${items.length}`;
    $("#packingProgressBar").style.width = `${percent}%`;
    $("#packingGrid").innerHTML = categories.map(category => `
      <section class="packing-card">
        <header><span>${escapeHtml(category.icon)}</span><div><h3>${escapeHtml(category.title)}</h3><small>${category.items.filter(item => packingChecked.has(item.id)).length} / ${category.items.length}</small></div></header>
        <div class="packing-items">${category.items.map(item => `
          <label class="packing-item ${packingChecked.has(item.id) ? "checked" : ""}">
            <input type="checkbox" data-packing-id="${escapeAttr(item.id)}" ${packingChecked.has(item.id) ? "checked" : ""}>
            <span><b>${escapeHtml(item.name)}</b>${item.note ? `<small>${escapeHtml(item.note)}</small>` : ""}</span>
          </label>`).join("")}
        </div>
      </section>`).join("");
  }

  function initMap() {
    if (!window.L) {
      $("#map").innerHTML = '<div style="display:grid;place-items:center;height:100%;padding:30px;text-align:center">地图组件加载失败，请检查网络连接。行程内容仍可正常查看。</div>';
      return;
    }
    map = L.map("map", { zoomControl: false, minZoom: 5 }).setView([25.98, 101.2], 7);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(map);
    routeLayer = L.layerGroup().addTo(map);
    markerLayer = L.layerGroup().addTo(map);
    userLayer = L.layerGroup().addTo(map);
    renderMap(true);
    map.on("locationfound", onLocationFound);
    map.on("locationerror", () => toast("无法获取位置，请允许浏览器定位；手机端需使用 HTTPS"));
  }

  function renderMap(fitAll = false) {
    if (!map) return;
    routeLayer.clearLayers();
    markerLayer.clearLayers();
    markers.clear();
    const allPoints = [];
    trip.days.forEach((day, dayIndex) => {
      const daySpots = visibleSpots(day);
      const coordinates = daySpots.filter(validCoords).map(spot => [spot.lat, spot.lng]);
      if (coordinates.length > 1) L.polyline(coordinates, { color: day.color, weight: dayIndex === activeDayIndex ? 5 : 2, opacity: dayIndex === activeDayIndex ? .85 : .28, dashArray: dayIndex === activeDayIndex ? null : "5 7" }).addTo(routeLayer);
      daySpots.forEach((spot, spotIndex) => {
        if (!validCoords(spot)) return;
        const marker = L.marker([spot.lat, spot.lng], { icon: markerIcon(spotIndex + 1, false, spot.id === activeSpotId), zIndexOffset: dayIndex === activeDayIndex ? 500 : 0, opacity: dayIndex === activeDayIndex ? 1 : .6 })
          .addTo(markerLayer).bindTooltip(`${day.city} · ${spot.name}`, { direction: "top", offset: [0, -17] });
        marker.on("click", () => { activeDayIndex = dayIndex; openSpot(spot.id); });
        markers.set(spot.id, marker);
        allPoints.push([spot.lat, spot.lng]);
      });
      if (day.stay && validCoords(day.stay)) {
        const stayMarker = L.marker([day.stay.lat, day.stay.lng], { icon: markerIcon("⌂", true, false), opacity: dayIndex === activeDayIndex ? 1 : .6 })
          .addTo(markerLayer).bindTooltip(`住宿 · ${day.stay.name}`, { direction: "top", offset: [0, -17] });
        stayMarker.on("click", () => { activeDayIndex = dayIndex; openStay(); });
        allPoints.push([day.stay.lat, day.stay.lng]);
      }
    });
    if (fitAll && allPoints.length) map.fitBounds(allPoints, { padding: [60, 60] });
    else focusActiveDay();
    updateWeather();
  }

  function markerIcon(label, hotel, active) {
    return L.divIcon({ className: "custom-marker", iconSize: [36, 36], iconAnchor: [18, 32], html: `<div class="marker-pin ${hotel ? "hotel" : ""} ${active ? "active" : ""}"><span>${label}</span></div>` });
  }

  function focusActiveDay() {
    if (!map) return;
    const day = trip.days[activeDayIndex];
    const points = visibleSpots(day).filter(validCoords).map(item => [item.lat, item.lng]);
    if (day.stay && validCoords(day.stay)) points.push([day.stay.lat, day.stay.lng]);
    if (points.length === 1) map.flyTo(points[0], 13);
    else if (points.length) map.fitBounds(points, { padding: [80, 80], maxZoom: 12 });
  }

  function onLocationFound(event) {
    userLayer.clearLayers();
    L.marker(event.latlng, { icon: L.divIcon({ className: "custom-marker", iconSize: [20,20], html: '<div class="me-marker"></div>' }) }).addTo(userLayer).bindTooltip("我的位置");
    L.circle(event.latlng, { radius: event.accuracy, color: "#2d84d7", weight: 1, fillOpacity: .08 }).addTo(userLayer);
    map.flyTo(event.latlng, Math.max(map.getZoom(), 14));
    toast("已定位到当前位置");
  }

  async function updateWeather() {
    const day = trip.days[activeDayIndex];
    const weatherCityName = day.city.split("→")[0].trim();
    const place = visibleSpots(day).find(validCoords) || day.stay;
    if (!place) return;
    $("#weatherCity").textContent = `${weatherCityName} · 加载中`;
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${place.lat}&longitude=${place.lng}&current=temperature_2m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=Asia%2FShanghai&forecast_days=5`;
      const response = await fetch(url);
      if (!response.ok) throw new Error("Weather request failed");
      const data = await response.json();
      $("#weatherTemp").textContent = `${Math.round(data.current.temperature_2m)}°`;
      $("#weatherIcon").textContent = weatherIcon(data.current.weather_code);
      $("#weatherCity").textContent = `${weatherCityName} · 实时`;
      $("#weatherDays").innerHTML = data.daily.time.map((date, i) => `<div class="weather-day"><span>${i === 0 ? "今天" : weekday(date)}</span><b>${weatherIcon(data.daily.weather_code[i])}</b><small>${Math.round(data.daily.temperature_2m_max[i])}°</small></div>`).join("");
    } catch (error) {
      $("#weatherCity").textContent = `${weatherCityName} · 暂无天气`;
      $("#weatherDays").innerHTML = "";
    }
  }

  function weatherIcon(code) {
    if (code === 0) return "☀";
    if ([1,2].includes(code)) return "🌤";
    if (code === 3) return "☁";
    if ([45,48].includes(code)) return "≋";
    if (code >= 51 && code <= 67) return "☂";
    if (code >= 71 && code <= 77) return "❄";
    if (code >= 80 && code <= 82) return "🌦";
    if (code >= 95) return "⚡";
    return "☁";
  }

  function bindEvents() {
    $("#packingGrid").addEventListener("change", event => {
      const checkbox = event.target.closest("[data-packing-id]");
      if (!checkbox) return;
      if (checkbox.checked) packingChecked.add(checkbox.dataset.packingId);
      else packingChecked.delete(checkbox.dataset.packingId);
      localStorage.setItem(PACKING_KEY, JSON.stringify([...packingChecked]));
      renderPacking();
    });
    $("#packingResetBtn").addEventListener("click", () => {
      packingChecked.clear();
      localStorage.removeItem(PACKING_KEY);
      renderPacking();
      toast("物品清单已清空");
    });
    $("#dayTabs").addEventListener("click", event => {
      const button = event.target.closest("[data-day-index]");
      if (!button) return;
      activeDayIndex = Number(button.dataset.dayIndex);
      activeSpotId = null;
      renderAll();
    });
    $("#timeline").addEventListener("click", event => {
      const add = event.target.closest('[data-action="add-spot"]');
      if (add) return openSpotEditor(null);
      const stay = event.target.closest('[data-action="open-stay"]');
      if (stay) return openStay();
      const item = event.target.closest("[data-spot-id]");
      if (item) openSpot(item.dataset.spotId);
    });
    $("#drawerClose").addEventListener("click", closeDrawer);
    $("#drawerBackdrop").addEventListener("click", closeDrawer);
    $("#settingsBtn").addEventListener("click", openTripEditor);
    $("#editDayBtn").addEventListener("click", openDayEditor);
    $("#editorClose").addEventListener("click", closeEditor);
    $("#editorBackdrop").addEventListener("click", event => { if (event.target === event.currentTarget) closeEditor(); });
    $("#editorForm").addEventListener("submit", saveEditor);
    $("#editorForm").addEventListener("click", event => { if (event.target.id === "deleteSpotBtn") deleteActiveSpot(); });
    $("#fitRouteBtn").addEventListener("click", () => renderMap(true));
    $("#locateBtn").addEventListener("click", () => map ? map.locate({ setView: false, watch: false, enableHighAccuracy: true, timeout: 12000 }) : toast("地图尚未加载"));
    $("#moreBtn").addEventListener("click", () => $("#moreMenu").classList.toggle("open"));
    document.addEventListener("click", event => { if (!event.target.closest(".header-actions")) $("#moreMenu").classList.remove("open"); });
    $("#exportBtn").addEventListener("click", exportTrip);
    $("#importInput").addEventListener("change", importTrip);
    $("#resetBtn").addEventListener("click", resetTrip);
    $("#shareBtn").addEventListener("click", shareTrip);
    $$(".mobile-nav button").forEach(button => button.addEventListener("click", () => switchMobileView(button.dataset.mobileView)));
    window.addEventListener("resize", () => {
      const activeMobileView = $(".mobile-nav button.active")?.dataset.mobileView || "map";
      switchMobileView(activeMobileView);
      setTimeout(() => map && map.invalidateSize(), 120);
    });
  }

  function openSpot(spotId) {
    const day = trip.days[activeDayIndex];
    const spotIndex = day.spots.findIndex(item => item.id === spotId);
    const spot = day.spots[spotIndex];
    const visibleIndex = visibleSpots(day).findIndex(item => item.id === spotId);
    if (!spot) return;
    activeSpotId = spotId;
    const food = isFoodSpot(spot);
    const sourceUrl = safeExternalUrl(spot.sourceUrl);
    const evidenceSection = spot.evidence ? `<section class="drawer-section evidence-section"><h3>推荐依据</h3><p>${escapeHtml(spot.evidence)}</p>${sourceUrl ? `<a class="source-link" href="${escapeAttr(sourceUrl)}" target="_blank" rel="noopener">${escapeHtml(spot.sourceLabel || "查看推荐依据")} ↗</a>` : ""}</section>` : "";
    $("#drawerContent").innerHTML = `
      <header class="drawer-hero"><span class="drawer-index">STOP ${String(visibleIndex + 1).padStart(2,"0")} · ${escapeHtml(day.city)}</span><h2>${escapeHtml(spot.name)}</h2><p>${escapeHtml(spot.description)}</p><div class="spot-meta"><span class="chip">${escapeHtml(spot.time)}</span><span class="chip">${escapeHtml(spot.duration)}</span><span class="chip">${escapeHtml(spot.type)}</span></div></header>
      <section class="drawer-section"><h3>交通方式</h3><p>${escapeHtml(spot.transport)}</p></section>
      <section class="drawer-section"><h3>${food ? "建议点单顺序" : "建议游玩路线"}</h3><p>${escapeHtml(spot.route)}</p></section>
      <section class="drawer-section"><h3>${food ? "推荐菜与打卡点" : "网红打卡机位"}</h3><ul>${(spot.photoSpots || []).map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ul></section>
      ${evidenceSection}
      <section class="drawer-section"><h3>${food ? "预约与用餐提醒" : "到访提醒"}</h3><ul>${(spot.tips || []).map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ul></section>
      <div class="drawer-actions"><button class="btn secondary" id="editSpotBtn">编辑信息</button><a class="btn primary" href="${amapUrl(spot)}" target="_blank" rel="noopener">高德导航 ↗</a></div>`;
    $("#editSpotBtn").addEventListener("click", () => openSpotEditor(spotId));
    $("#detailDrawer").classList.add("open");
    $("#detailDrawer").setAttribute("aria-hidden", "false");
    $("#drawerBackdrop").classList.add("open");
    if (map && markers.has(spotId)) {
      map.flyTo([spot.lat, spot.lng], 14);
      markers.get(spotId).openTooltip();
    }
  }

  function openStay() {
    const day = trip.days[activeDayIndex];
    const stay = day?.stay;
    if (!stay) return;
    activeSpotId = null;
    const options = (stay.options || []).map(option => {
      const hotelUrl = safeExternalUrl(option.hotelUrl);
      const evidenceUrl = safeExternalUrl(option.evidenceUrl);
      return `<article class="stay-option">
        <div class="stay-option-head"><span class="stay-option-tag">${escapeHtml(option.tag || "住宿候选")}</span><h3>${escapeHtml(option.name)}</h3></div>
        <p><b>为什么推荐：</b>${escapeHtml(option.evidence || "")}</p>
        <p><b>更适合：</b>${escapeHtml(option.fit || "")}</p>
        <div class="stay-option-links">${hotelUrl ? `<a class="source-link" href="${escapeAttr(hotelUrl)}" target="_blank" rel="noopener">查看酒店 / 房型 ↗</a>` : ""}${evidenceUrl ? `<a class="source-link" href="${escapeAttr(evidenceUrl)}" target="_blank" rel="noopener">查看榜单依据 ↗</a>` : ""}</div>
      </article>`;
    }).join("");
    $("#drawerContent").innerHTML = `
      <header class="drawer-hero stay-hero"><span class="drawer-index">STAY · DAY ${String(activeDayIndex + 1).padStart(2,"0")}</span><h2>${escapeHtml(stay.name)}</h2><p>${escapeHtml(stay.address)}</p><div class="spot-meta"><span class="chip">${stay.options?.length || 0} 个住宿候选</span><span class="chip">已给预订核验项</span></div></header>
      <section class="drawer-section"><h3>为什么住这里</h3><p>${escapeHtml(stay.why || stay.address)}</p></section>
      <section class="drawer-section stay-options"><h3>有依据的住宿选择</h3>${options || "<p>还没有填写具体住宿候选。</p>"}</section>
      <section class="drawer-section"><h3>下单前逐项确认</h3><ul>${(stay.booking || []).map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ul></section>
      <div class="drawer-actions"><button class="btn secondary" id="editStayBtn">编辑当天</button><a class="btn primary" href="${amapUrl(stay)}" target="_blank" rel="noopener">导航到住宿区域 ↗</a></div>`;
    $("#editStayBtn").addEventListener("click", () => { closeDrawer(); openDayEditor(); });
    $("#detailDrawer").classList.add("open");
    $("#detailDrawer").setAttribute("aria-hidden", "false");
    $("#drawerBackdrop").classList.add("open");
    if (map && validCoords(stay)) map.flyTo([stay.lat, stay.lng], 14);
  }

  function closeDrawer() {
    $("#detailDrawer").classList.remove("open");
    $("#detailDrawer").setAttribute("aria-hidden", "true");
    $("#drawerBackdrop").classList.remove("open");
    activeSpotId = null;
    if (map) renderMap();
  }

  function openTripEditor() {
    editorContext = { type: "trip" };
    $("#editorTitle").textContent = "编辑整趟行程";
    $("#editorForm").innerHTML = `<div class="form-grid">
      ${field("行程名称", "title", trip.title, "text", true)}
      ${field("开始日期", "startDate", trip.startDate, "date")}
      ${field("同行信息", "companions", trip.companions)}
      ${textarea("行程简介", "subtitle", trip.subtitle, true)}
      <p class="form-hint">页面内修改会保存在当前设备。需要带到另一台设备时，可使用“分享行程”复制含数据的链接，或导出 JSON。</p>
    </div>${formActions()}`;
    openEditor();
  }

  function openDayEditor() {
    const day = trip.days[activeDayIndex];
    editorContext = { type: "day", dayIndex: activeDayIndex };
    $("#editorTitle").textContent = `编辑 Day ${activeDayIndex + 1}`;
    $("#editorForm").innerHTML = `<div class="form-grid">
      ${field("城市", "city", day.city)}${field("当天标题", "title", day.title)}
      ${textarea("当天简介", "summary", day.summary, true)}
      ${field("主要交通", "transport", day.transport)}${field("预计里程", "distance", day.distance)}
      ${field("住宿名称", "stayName", day.stay?.name || "", "text", true)}${field("住宿地址 / 备注", "stayAddress", day.stay?.address || "", "text", true)}
      ${field("住宿纬度", "stayLat", day.stay?.lat || "", "number")}${field("住宿经度", "stayLng", day.stay?.lng || "", "number")}
    </div>${formActions()}`;
    openEditor();
  }

  function openSpotEditor(spotId) {
    closeDrawer();
    const day = trip.days[activeDayIndex];
    const spotIndex = spotId ? day.spots.findIndex(item => item.id === spotId) : -1;
    const spot = spotIndex >= 0 ? day.spots[spotIndex] : { name:"", type:"景点", time:"09:00", duration:"2 小时", lat:"", lng:"", transport:"", route:"", photoSpots:[], tips:[], description:"" };
    editorContext = { type: "spot", dayIndex: activeDayIndex, spotIndex };
    $("#editorTitle").textContent = spotIndex >= 0 ? `编辑 · ${spot.name}` : "添加一个地点";
    $("#editorForm").innerHTML = `<div class="form-grid">
      ${field("地点名称", "name", spot.name, "text", true)}${field("类型", "type", spot.type)}
      ${field("开始时间", "time", spot.time, "time")}${field("游玩时长", "duration", spot.duration)}
      ${field("纬度", "lat", spot.lat, "number")}${field("经度", "lng", spot.lng, "number")}
      ${textarea("地点简介", "description", spot.description, true)}${textarea("交通方式", "transport", spot.transport, true)}
      ${textarea("游玩路线", "route", spot.route, true)}${textarea("打卡机位（每行一个）", "photoSpots", spot.photoSpots.join("\n"), true)}
      ${textarea("注意事项（每行一个）", "tips", spot.tips.join("\n"), true)}
      <p class="form-hint">经纬度可在地图应用中搜索地点后查看；填入后会立刻出现在左侧地图。</p>
    </div>${formActions(spotIndex >= 0)}`;
    openEditor();
  }

  function openEditor() { $("#editorBackdrop").classList.add("open"); setTimeout(() => $("#editorForm input")?.focus(), 50); }
  function closeEditor() { $("#editorBackdrop").classList.remove("open"); editorContext = null; }

  function saveEditor(event) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    if (editorContext.type === "trip") {
      Object.assign(trip, { title: values.title, startDate: values.startDate, companions: values.companions, subtitle: values.subtitle });
    } else if (editorContext.type === "day") {
      const day = trip.days[editorContext.dayIndex];
      Object.assign(day, { city: values.city, title: values.title, summary: values.summary, transport: values.transport, distance: values.distance });
      day.stay = { ...(day.stay || {}), name: values.stayName, address: values.stayAddress, lat: Number(values.stayLat), lng: Number(values.stayLng) };
    } else if (editorContext.type === "spot") {
      const day = trip.days[editorContext.dayIndex];
      const existingSpot = editorContext.spotIndex >= 0 ? day.spots[editorContext.spotIndex] : {};
      const spot = {
        ...existingSpot,
        id: editorContext.spotIndex >= 0 ? day.spots[editorContext.spotIndex].id : `${slugify(values.name)}-${Date.now().toString(36)}`,
        name: values.name, type: values.type, time: values.time, duration: values.duration,
        lat: Number(values.lat), lng: Number(values.lng), description: values.description,
        transport: values.transport, route: values.route,
        photoSpots: lines(values.photoSpots), tips: lines(values.tips)
      };
      if (editorContext.spotIndex >= 0) day.spots[editorContext.spotIndex] = spot; else day.spots.push(spot);
    }
    closeEditor();
    saveTrip();
  }

  function deleteActiveSpot() {
    if (!editorContext || editorContext.type !== "spot" || editorContext.spotIndex < 0) return;
    const day = trip.days[editorContext.dayIndex];
    if (!confirm(`确定删除“${day.spots[editorContext.spotIndex].name}”吗？`)) return;
    day.spots.splice(editorContext.spotIndex, 1);
    closeEditor();
    saveTrip("地点已删除");
  }

  function field(label, name, value = "", type = "text", full = false) {
    const step = type === "number" ? ' step="any"' : "";
    return `<div class="field ${full ? "full" : ""}"><label for="f-${name}">${label}</label><input id="f-${name}" name="${name}" type="${type}" value="${escapeAttr(value)}"${step} required></div>`;
  }
  function textarea(label, name, value = "", full = false) { return `<div class="field ${full ? "full" : ""}"><label for="f-${name}">${label}</label><textarea id="f-${name}" name="${name}">${escapeHtml(value)}</textarea></div>`; }
  function formActions(deletable = false) { return `<div class="form-actions">${deletable ? '<button class="btn delete-btn" type="button" id="deleteSpotBtn">删除地点</button>' : ""}<button class="btn secondary" type="button" onclick="document.querySelector('#editorClose').click()">取消</button><button class="btn primary" type="submit">保存修改</button></div>`; }

  function exportTrip() {
    const blob = new Blob([JSON.stringify(trip, null, 2)], { type: "application/json;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob); link.download = `云南行程-${new Date().toISOString().slice(0,10)}.json`; link.click();
    URL.revokeObjectURL(link.href); $("#moreMenu").classList.remove("open"); toast("行程已导出");
  }

  async function importTrip(event) {
    const file = event.target.files[0]; if (!file) return;
    try {
      const next = JSON.parse(await file.text());
      if (!next.title || !Array.isArray(next.days)) throw new Error("格式不正确");
      trip = next; activeDayIndex = 0; saveTrip("行程已导入");
    } catch (error) { toast("导入失败：请使用本页面导出的 JSON"); }
    event.target.value = "";
  }

  function resetTrip() {
    if (!confirm("确定恢复示例行程？当前设备上的修改会被覆盖。")) return;
    trip = clone(window.DEFAULT_TRIP); activeDayIndex = 0; saveTrip("已恢复示例行程"); $("#moreMenu").classList.remove("open");
  }

  async function shareTrip() {
    if (location.protocol === "file:" || ["localhost", "127.0.0.1"].includes(location.hostname)) {
      editorContext = { type: "share-help" };
      $("#editorTitle").textContent = "把行程带到手机";
      $("#editorForm").innerHTML = `<div class="share-help">
        <section><span class="day-kicker">RECOMMENDED</span><h3>发布为 HTTPS 网页</h3><p>当前是电脑本地文件，手机不能打开 C 盘路径。把这个文件夹发布到 GitHub Pages 或 Cloudflare Pages 后，手机打开网址即可；定位功能也需要 HTTPS。</p></section>
        <section><span class="day-kicker">SAME WI-FI</span><h3>临时从电脑访问</h3><p>在本目录运行 <code>python -m http.server 4173 --bind 0.0.0.0</code>，再让手机和电脑连接同一 Wi-Fi，手机访问 <code>http://电脑IPv4地址:4173</code>。电脑关机后链接会失效，手机定位也可能受 HTTP 限制。</p></section>
        <p class="form-hint">发布后再点“分享行程”，会生成包含当前编辑内容的链接。不同设备上的后续修改目前不会自动同步。</p>
      </div><div class="form-actions"><button class="btn primary" type="button" onclick="document.querySelector('#editorClose').click()">知道了</button></div>`;
      openEditor();
      return;
    }
    const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(trip))));
    const url = `${location.origin}${location.pathname}#trip=${encodeURIComponent(encoded)}`;
    try {
      if (navigator.share && url.length < 24000) await navigator.share({ title: trip.title, text: "我的云南旅行行程", url });
      else { await navigator.clipboard.writeText(url); toast("分享链接已复制，可在另一台设备打开"); }
    } catch (error) { if (error.name !== "AbortError") toast("分享失败，请改用导出 JSON"); }
  }

  function switchMobileView(view) {
    $$(".mobile-nav button").forEach(button => button.classList.toggle("active", button.dataset.mobileView === view));
    if (innerWidth > 760) { $("#mapPane").classList.add("mobile-active"); $("#routePane").classList.add("mobile-active"); return; }
    if (view === "map") {
      $("#mapPane").classList.add("mobile-active"); $("#routePane").classList.remove("mobile-active");
      setTimeout(() => map && map.invalidateSize(), 80);
    } else {
      $("#mapPane").classList.remove("mobile-active"); $("#routePane").classList.add("mobile-active");
      if (view === "tips") setTimeout(() => $("#noticeSection").scrollIntoView(), 50); else $("#routePane").scrollTop = 0;
    }
  }

  function navigate(place) { window.open(amapUrl(place), "_blank", "noopener"); }
  function amapUrl(place) { return `https://uri.amap.com/navigation?to=${place.lng},${place.lat},${encodeURIComponent(place.name)}&mode=car&policy=1&src=yunnan-trip&coordinate=wgs84&callnative=1`; }
  function isFoodSpot(spot) { return /餐|火锅|米线|小吃|老店|必吃|早餐|午餐|晚餐/.test(String(spot?.type || "")); }
  function safeExternalUrl(value) {
    if (!value) return "";
    try {
      const url = new URL(value, location.href);
      return ["http:", "https:"].includes(url.protocol) ? url.href : "";
    } catch (error) { return ""; }
  }
  function validCoords(item) { return item && Number.isFinite(Number(item.lat)) && Number.isFinite(Number(item.lng)) && Number(item.lat) !== 0 && Number(item.lng) !== 0; }
  function visibleSpots(day) { return day.spots; }
  function lines(value) { return String(value || "").split(/\r?\n/).map(item => item.trim()).filter(Boolean); }
  function slugify(value) { return String(value || "spot").toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-").replace(/^-|-$/g, "") || "spot"; }
  function dayDate(index) { if (!trip.startDate) return ["抵达", "云杉坪", "转大理", "环洱海", "转昆明", "返南京"][index] || "待定"; const date = new Date(`${trip.startDate}T00:00:00`); date.setDate(date.getDate() + index); return `${date.getMonth()+1}/${date.getDate()}`; }
  function formatRange(start, length) { const from = new Date(`${start}T00:00:00`); const to = new Date(from); to.setDate(to.getDate() + length - 1); return `${from.getMonth()+1}.${from.getDate()}—${to.getMonth()+1}.${to.getDate()}`; }
  function weekday(date) { return new Intl.DateTimeFormat("zh-CN", { weekday: "short" }).format(new Date(`${date}T00:00:00`)); }
  function toast(message) { const el = $("#toast"); el.textContent = message; el.classList.add("show"); clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove("show"), 2400); }
  function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char])); }
  function escapeAttr(value) { return escapeHtml(value).replace(/`/g, "&#96;"); }

  init();
})();
