const CONFIG = {
  SUPABASE_URL: "https://kbxvdygiafmcnsivvudl.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_ZmX8EQwS2QTqMAyVNpOL1g_6elv21wx",
  STORAGE_BUCKET: "product-images",
};

const sb = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

const state = {
  user: null,
  adminProfile: null,
  activeTab: "orders",
  search: "",
  vendors: [],
  products: [],
  orders: [],
  orderItemsByOrder: {},
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

document.addEventListener("DOMContentLoaded", init);

async function init() {
  bindEvents();

  const { data } = await sb.auth.getSession();

  if (data.session?.user) {
    state.user = data.session.user;
    await enterAdmin();
  } else {
    showLogin();
  }
}

function bindEvents() {
  $("#loginForm").addEventListener("submit", handleLogin);
  $("#logoutBtn").addEventListener("click", handleLogout);
  $("#refreshBtn").addEventListener("click", loadActiveTab);

  $$(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });

  $("#globalSearch").addEventListener("input", (event) => {
    state.search = event.target.value.trim().toLowerCase();
    renderActiveTab();
  });

  $("#addVendorBtn").addEventListener("click", openVendorModal);
  $("#vendorForm").addEventListener("submit", handleVendorCreate);

  $("#addProductBtn").addEventListener("click", () => openProductModal());
  $("#productForm").addEventListener("submit", handleProductSave);
  $("#productImage").addEventListener("change", previewProductImage);

  $$("[data-close-modal]").forEach((btn) => {
    btn.addEventListener("click", () => closeModal(btn.dataset.closeModal));
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeModal("vendorModal");
      closeModal("productModal");
    }
  });
}

async function handleLogin(event) {
  event.preventDefault();

  const email = $("#loginEmail").value.trim();
  const password = $("#loginPassword").value;
  const message = $("#loginMessage");

  message.textContent = "登入中...";

  const { data, error } = await sb.auth.signInWithPassword({ email, password });

  if (error) {
    message.textContent = `登入失敗：${error.message}`;
    return;
  }

  state.user = data.user;
  await enterAdmin();
}

async function enterAdmin() {
  const { data, error } = await sb
    .from("admin_profiles")
    .select("*")
    .eq("id", state.user.id)
    .eq("is_active", true)
    .single();

  if (error || !data) {
    await sb.auth.signOut();
    state.user = null;
    state.adminProfile = null;
    $("#loginMessage").textContent = "這個帳號不是後台管理員，請先加入 admin_profiles。";
    showLogin();
    return;
  }

  state.adminProfile = data;
  $("#adminInfo").textContent = `${data.name || "管理員"}｜${state.user.email}｜${data.role}`;

  showAdmin();
  await loadActiveTab();
}

function showLogin() {
  $("#loginPage").classList.remove("hidden");
  $("#adminPage").classList.add("hidden");
}

function showAdmin() {
  $("#loginPage").classList.add("hidden");
  $("#adminPage").classList.remove("hidden");
}

async function handleLogout() {
  await sb.auth.signOut();
  state.user = null;
  state.adminProfile = null;
  showLogin();
  toast("已登出");
}

function switchTab(tab) {
  state.activeTab = tab;

  $$(".tab-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === tab);
  });

  $$(".panel").forEach((panel) => {
    panel.classList.remove("active");
  });

  $(`#${tab}Panel`).classList.add("active");
  loadActiveTab();
}

async function loadActiveTab() {
  if (state.activeTab === "orders") await loadOrders();
  if (state.activeTab === "vendors") await loadVendors();
  if (state.activeTab === "products") await loadProducts();
}

function renderActiveTab() {
  if (state.activeTab === "orders") renderOrders();
  if (state.activeTab === "vendors") renderVendors();
  if (state.activeTab === "products") renderProducts();
}

/* =========================
   攤商帳號
========================= */

function openVendorModal() {
  $("#vendorCode").value = "";
  $("#vendorPassword").value = "";
  $("#vendorPriceLevel").value = "一般";
  $("#vendorCreateResult").classList.add("hidden");
  $("#vendorCreateResult").innerHTML = "";
  openModal("vendorModal");
}

async function handleVendorCreate(event) {
  event.preventDefault();

  const vendorCode = $("#vendorCode").value.trim().toUpperCase();
  const password = $("#vendorPassword").value.trim();
  const priceLevel = $("#vendorPriceLevel").value;
  const resultBox = $("#vendorCreateResult");

  if (!vendorCode || !password) {
    toast("請輸入攤商編號與電話密碼");
    return;
  }

  resultBox.classList.remove("hidden");
  resultBox.innerHTML = "建立中...";

  const { data, error } = await sb.functions.invoke("create-vendor-account", {
    body: {
      vendor_code: vendorCode,
      password,
      price_level: priceLevel,
    },
  });

  if (error) {
    resultBox.innerHTML = `建立失敗：${escapeHtml(error.message)}`;
    toast("建立失敗");
    return;
  }

  if (!data?.ok) {
    resultBox.innerHTML = `建立失敗：${escapeHtml(data?.error || "未知錯誤")}`;
    toast("建立失敗");
    return;
  }

  const vendor = data.vendor;

  resultBox.innerHTML = `
    建立成功<br>
    攤商登入帳號：${escapeHtml(vendor.vendor_code)}<br>
    系統 Email：${escapeHtml(vendor.system_email)}<br>
    Supabase UID：${escapeHtml(vendor.auth_user_id)}<br>
    電話後三碼：${escapeHtml(vendor.phone_last3)}<br>
    價格等級：${escapeHtml(vendor.price_level)}
  `;

  await loadVendors();
  toast("攤商帳號已建立");
}

async function loadVendors() {
  const body = $("#vendorsBody");
  body.innerHTML = `<div class="empty">讀取攤商帳號中...</div>`;

  const { data, error } = await sb
    .from("vendor_accounts")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    body.innerHTML = `<div class="empty">攤商帳號讀取失敗：${escapeHtml(error.message)}</div>`;
    return;
  }

  state.vendors = data || [];
  renderVendors();
}

function renderVendors() {
  const keyword = state.search;

  const filtered = state.vendors.filter((vendor) => {
    const text = [
      vendor.vendor_code,
      vendor.auth_user_id,
      vendor.phone_last3,
      vendor.price_level,
      vendor.is_active ? "啟用" : "停用",
    ].join(" ").toLowerCase();

    return !keyword || text.includes(keyword);
  });

  const body = $("#vendorsBody");

  if (filtered.length === 0) {
    body.innerHTML = `<div class="empty">目前沒有符合條件的攤商帳號。</div>`;
    return;
  }

  body.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>攤商編號</th>
          <th>Supabase UID</th>
          <th>電話後三碼</th>
          <th>價格等級</th>
          <th>狀態</th>
          <th>建立時間</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        ${filtered.map((vendor) => `
          <tr>
            <td><strong>${escapeHtml(vendor.vendor_code)}</strong></td>
            <td><small>${escapeHtml(vendor.auth_user_id)}</small></td>
            <td>${escapeHtml(vendor.phone_last3 || "-")}</td>
            <td>${escapeHtml(vendor.price_level || "一般")}</td>
            <td>
              <span class="badge ${vendor.is_active ? "green" : "red"}">
                ${vendor.is_active ? "啟用" : "停用"}
              </span>
            </td>
            <td>${formatDateTime(vendor.created_at)}</td>
            <td>
              <button class="mini-btn" type="button" data-action="toggle-vendor" data-id="${vendor.id}">
                ${vendor.is_active ? "停用" : "啟用"}
              </button>
            </td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;

  $$("[data-action='toggle-vendor']").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await toggleVendorActive(btn.dataset.id);
    });
  });
}

async function toggleVendorActive(vendorId) {
  const vendor = state.vendors.find((item) => item.id === vendorId);
  if (!vendor) return;

  const nextActive = !vendor.is_active;

  const { error } = await sb
    .from("vendor_accounts")
    .update({
      is_active: nextActive,
      updated_at: new Date().toISOString(),
    })
    .eq("id", vendorId);

  if (error) {
    toast(`更新失敗：${error.message}`);
    return;
  }

  vendor.is_active = nextActive;
  renderVendors();
  toast(nextActive ? "攤商已啟用" : "攤商已停用");
}

/* =========================
   商品管理
========================= */

async function loadProducts() {
  const body = $("#productsBody");
  body.innerHTML = `<div class="empty">讀取商品中...</div>`;

  const { data, error } = await sb
    .from("products")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false });

  if (error) {
    body.innerHTML = `<div class="empty">商品讀取失敗：${escapeHtml(error.message)}</div>`;
    return;
  }

  state.products = data || [];
  renderProducts();
}

function renderProducts() {
  const keyword = state.search;

  const filtered = state.products.filter((product) => {
    const text = [
      product.sku,
      product.name,
      product.brand_supplier,
      product.category,
      product.package_qty,
      product.unit,
      product.box_spec,
      product.box_price,
      product.reward_rate,
      product.description,
      Array.isArray(product.tags) ? product.tags.join(" ") : "",
    ].join(" ").toLowerCase();

    return !keyword || text.includes(keyword);
  });

  const body = $("#productsBody");

  if (filtered.length === 0) {
    body.innerHTML = `<div class="empty">目前沒有符合條件的商品。</div>`;
    return;
  }

  body.innerHTML = filtered.map(renderProductCard).join("");

  $$("[data-action='edit-product']").forEach((btn) => {
    btn.addEventListener("click", () => {
      const product = state.products.find((item) => item.id === btn.dataset.id);
      openProductModal(product);
    });
  });

  $$("[data-action='toggle-product-visible']").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await toggleProductVisible(btn.dataset.id);
    });
  });

  $$("[data-action='toggle-product-featured']").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await toggleProductFeatured(btn.dataset.id);
    });
  });
}

function renderProductCard(product) {
  const badges = [];

  badges.push(product.is_visible
    ? `<span class="badge green">前台顯示</span>`
    : `<span class="badge red">已隱藏</span>`
  );

  if (product.is_featured) {
    badges.push(`<span class="badge blue">熱門</span>`);
  }

  if (product.box_enabled && Number(product.box_price || 0) > 0) {
    badges.push(`<span class="badge blue">箱購 ${money(product.box_price)}</span>`);
  }

  if (Number(product.reward_rate || 0) > 0) {
    badges.push(`<span class="badge">回饋 ${Number(product.reward_rate)}%</span>`);
  }

  const singleSpec = `${escapeHtml(product.package_qty || "-")} ${escapeHtml(product.unit || "")}`.trim();
  const boxText = product.box_enabled && Number(product.box_price || 0) > 0
    ? `單箱：${escapeHtml(product.box_spec || "-")} / ${money(product.box_price)}<br>`
    : "";

  return `
    <article class="product-card">
      ${product.image_url
        ? `<img class="product-img" src="${escapeAttr(product.image_url)}" alt="${escapeAttr(product.name)}" loading="lazy">`
        : `<div class="product-placeholder">無圖片</div>`
      }

      <div class="product-body">
        <h3>${escapeHtml(product.name)}</h3>

        <div class="product-info">
          分類：${escapeHtml(product.category || "-")}<br>
          供應商：${escapeHtml(product.brand_supplier || "-")}<br>
          單包：${singleSpec} / ${money(product.price)}<br>
          ${boxText}
          庫存：${Number(product.stock || 0)}
        </div>

        <div class="price-line">
          <span class="price">${money(product.price)}</span>
          <span>成本 ${money(product.cost || 0)}</span>
        </div>

        <div class="badges">${badges.join("")}</div>

        <div class="row-actions">
          <button class="mini-btn" type="button" data-action="edit-product" data-id="${product.id}">編輯</button>
          <button class="mini-btn" type="button" data-action="toggle-product-visible" data-id="${product.id}">
            ${product.is_visible ? "隱藏" : "顯示"}
          </button>
          <button class="mini-btn" type="button" data-action="toggle-product-featured" data-id="${product.id}">
            ${product.is_featured ? "取消熱門" : "設熱門"}
          </button>
        </div>
      </div>
    </article>
  `;
}

function openProductModal(product = null) {
  $("#productModalTitle").textContent = product ? "編輯商品" : "新增商品";
  $("#productId").value = product?.id || "";
  $("#productName").value = product?.name || "";
  $("#productSku").value = product?.sku || "";
  $("#productBrandSupplier").value = product?.brand_supplier || "";
  $("#productCategory").value = product?.category || "";
  $("#productPackageQty").value = product?.package_qty || "";
  $("#productUnit").value = product?.unit || "";
  $("#productPrice").value = product?.price ?? "";
  $("#productCost").value = product?.cost ?? "";
  $("#productBoxSpec").value = product?.box_spec || "";
  $("#productBoxPrice").value = product?.box_price ?? 0;
  $("#productStock").value = product?.stock ?? 0;
  $("#productMinStock").value = product?.min_stock ?? 0;
  const legacyRewardRate = Number(product?.reward_rate || 0);
  $("#productSingleRewardRate").value = product?.single_reward_rate ?? legacyRewardRate;
  $("#productBoxRewardRate").value = product?.box_reward_rate ?? legacyRewardRate;
  $("#productSort").value = product?.sort_order ?? 999;
  $("#productTags").value = Array.isArray(product?.tags) ? product.tags.join(",") : "";
  $("#productDescription").value = product?.description || "";
  $("#productFeatured").checked = Boolean(product?.is_featured);
  $("#productBoxEnabled").checked = Boolean(product?.box_enabled);
  $("#productVisible").checked = product ? Boolean(product.is_visible) : true;
  $("#productImage").value = "";

  const preview = $("#productImagePreview");

  if (product?.image_url) {
    preview.src = product.image_url;
    preview.classList.remove("hidden");
  } else {
    preview.src = "";
    preview.classList.add("hidden");
  }

  openModal("productModal");
}

function previewProductImage() {
  const file = $("#productImage").files[0];
  const preview = $("#productImagePreview");

  if (!file) {
    preview.src = "";
    preview.classList.add("hidden");
    return;
  }

  preview.src = URL.createObjectURL(file);
  preview.classList.remove("hidden");
}

async function handleProductSave(event) {
  event.preventDefault();

  const id = $("#productId").value;
  const file = $("#productImage").files[0];

  const payload = {
    name: $("#productName").value.trim(),
    sku: nullIfEmpty($("#productSku").value),
    brand_supplier: nullIfEmpty($("#productBrandSupplier").value),
    category: nullIfEmpty($("#productCategory").value),
    package_qty: nullIfEmpty($("#productPackageQty").value),
    unit: nullIfEmpty($("#productUnit").value),
    price: toNumber($("#productPrice").value),
    cost: toNumber($("#productCost").value),
    box_spec: nullIfEmpty($("#productBoxSpec").value),
    box_price: toNumber($("#productBoxPrice").value),
    box_enabled: $("#productBoxEnabled").checked,
    stock: toInteger($("#productStock").value),
    min_stock: toInteger($("#productMinStock").value),
    reward_rate: toNumber($("#productRewardRate").value),
    sort_order: toInteger($("#productSort").value) || 999,
    tags: parseTags($("#productTags").value),
    description: nullIfEmpty($("#productDescription").value),
    is_featured: $("#productFeatured").checked,
    is_visible: $("#productVisible").checked,
    updated_at: new Date().toISOString(),
  };

  if (!payload.name) {
    toast("請輸入商品名稱");
    return;
  }

  if (payload.price <= 0) {
    toast("請輸入單包價");
    return;
  }

  if (payload.box_enabled && payload.box_price <= 0) {
    toast("已勾選開放箱購顯示，請輸入單箱價");
    return;
  }

  if (file) {
    try {
      const uploaded = await uploadProductImage(file);
      payload.image_url = uploaded.image_url;
      payload.image_path = uploaded.image_path;
    } catch (error) {
      toast(error.message);
      return;
    }
  }

  const result = id
    ? await sb.from("products").update(payload).eq("id", id)
    : await sb.from("products").insert(payload);

  if (result.error) {
    toast(`商品儲存失敗：${result.error.message}`);
    return;
  }

  closeModal("productModal");
  await loadProducts();
  toast("商品已儲存");
}

async function uploadProductImage(file) {
  const validTypes = ["image/jpeg", "image/png", "image/webp"];

  if (!validTypes.includes(file.type)) {
    throw new Error("圖片格式請使用 JPG、PNG 或 WebP");
  }

  if (file.size > 5 * 1024 * 1024) {
    throw new Error("圖片不可超過 5MB");
  }

  const ext = getFileExt(file.name, file.type);
  const fileName = `${Date.now()}-${safeRandomId()}.${ext}`;
  const path = `products/${fileName}`;

  const { error } = await sb.storage
    .from(CONFIG.STORAGE_BUCKET)
    .upload(path, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: file.type,
    });

  if (error) {
    throw new Error(`圖片上傳失敗：${error.message}`);
  }

  const { data } = sb.storage
    .from(CONFIG.STORAGE_BUCKET)
    .getPublicUrl(path);

  return {
    image_url: data.publicUrl,
    image_path: path,
  };
}

async function toggleProductVisible(productId) {
  const product = state.products.find((item) => item.id === productId);
  if (!product) return;

  const { error } = await sb
    .from("products")
    .update({
      is_visible: !product.is_visible,
      updated_at: new Date().toISOString(),
    })
    .eq("id", productId);

  if (error) {
    toast(`更新失敗：${error.message}`);
    return;
  }

  product.is_visible = !product.is_visible;
  renderProducts();
  toast(product.is_visible ? "商品已顯示" : "商品已隱藏");
}

async function toggleProductFeatured(productId) {
  const product = state.products.find((item) => item.id === productId);
  if (!product) return;

  const { error } = await sb
    .from("products")
    .update({
      is_featured: !product.is_featured,
      updated_at: new Date().toISOString(),
    })
    .eq("id", productId);

  if (error) {
    toast(`更新失敗：${error.message}`);
    return;
  }

  product.is_featured = !product.is_featured;
  renderProducts();
  toast(product.is_featured ? "已設為熱門" : "已取消熱門");
}

/* =========================
   訂單管理
========================= */

async function loadOrders() {
  const body = $("#ordersBody");
  body.innerHTML = `<div class="empty">讀取訂單中...</div>`;

  const { data, error } = await sb
    .from("orders")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    body.innerHTML = `<div class="empty">訂單讀取失敗：${escapeHtml(error.message)}</div>`;
    return;
  }

  state.orders = data || [];
  state.orderItemsByOrder = {};

  const orderIds = state.orders.map((order) => order.id);

  if (orderIds.length > 0) {
    const { data: items, error: itemError } = await sb
      .from("order_items")
      .select("*")
      .in("order_id", orderIds)
      .order("created_at", { ascending: true });

    if (!itemError && items) {
      items.forEach((item) => {
        if (!state.orderItemsByOrder[item.order_id]) {
          state.orderItemsByOrder[item.order_id] = [];
        }

        state.orderItemsByOrder[item.order_id].push(item);
      });
    }
  }

  renderOrders();
}

function renderOrders() {
  const keyword = state.search;

  const filtered = state.orders.filter((order) => {
    const text = [
      order.order_no,
      order.vendor_code,
      order.order_status,
      order.payment_status,
      order.payment_method,
      order.customer_note,
      order.admin_note,
    ].join(" ").toLowerCase();

    return !keyword || text.includes(keyword);
  });

  renderOrderStats(filtered);

  const body = $("#ordersBody");

  if (filtered.length === 0) {
    body.innerHTML = `<div class="empty">目前沒有符合條件的訂單。</div>`;
    return;
  }

  body.innerHTML = filtered.map(renderOrderCard).join("");

  $$("[data-action='order-status']").forEach((select) => {
    select.addEventListener("change", async () => {
      await updateOrderStatus(select.dataset.id, select.value);
    });
  });
}

function renderOrderCard(order) {
  const items = state.orderItemsByOrder[order.id] || [];

  const itemText = items.length
    ? items.map((item) => {
      const typeLabel = item.purchase_type === "box" ? "箱購" : "單包";
      return `${escapeHtml(item.product_name)}（${typeLabel}）× ${item.quantity}`;
    }).join("、")
    : "尚無品項明細";

  const statusClass = order.order_status === "已完成"
    ? "done"
    : order.order_status === "已取消"
      ? "cancel"
      : "";

  return `
    <article class="order-card">
      <div class="order-top">
        <div>
          <div class="order-no">${escapeHtml(order.order_no || order.id)}</div>
          <div class="order-meta">
            攤商編號：<strong>${escapeHtml(order.vendor_code || "-")}</strong><br>
            建立時間：${formatDateTime(order.created_at)}<br>
            付款：${escapeHtml(order.payment_method || "貨到付款")} / ${escapeHtml(order.payment_status || "未收款")}
          </div>
        </div>

        <div class="order-total">${money(order.total_amount)}</div>
      </div>

      <div class="badges">
        <span class="status-pill ${statusClass}">${escapeHtml(order.order_status || "待確認")}</span>
      </div>

      <div class="order-items">${itemText}</div>

      ${order.customer_note ? `<div class="order-meta">客戶備註：${escapeHtml(order.customer_note)}</div>` : ""}
      ${order.admin_note ? `<div class="order-meta">內部備註：${escapeHtml(order.admin_note)}</div>` : ""}

      <div class="order-actions">
        <select data-action="order-status" data-id="${order.id}">
          ${["待確認", "已確認", "備貨中", "配送中", "已完成", "已取消"].map((status) => {
            return `<option value="${status}" ${status === order.order_status ? "selected" : ""}>${status}</option>`;
          }).join("")}
        </select>
      </div>
    </article>
  `;
}

function renderOrderStats(orders) {
  const counts = {
    "待確認": 0,
    "已確認": 0,
    "備貨中": 0,
    "配送中": 0,
    "已完成": 0,
  };

  orders.forEach((order) => {
    if (counts[order.order_status] !== undefined) {
      counts[order.order_status] += 1;
    }
  });

  $("#orderStats").innerHTML = `
    <div class="stat-card"><strong>${orders.length}</strong><span>全部訂單</span></div>
    <div class="stat-card"><strong>${counts["待確認"]}</strong><span>待確認</span></div>
    <div class="stat-card"><strong>${counts["備貨中"]}</strong><span>備貨中</span></div>
    <div class="stat-card"><strong>${counts["配送中"]}</strong><span>配送中</span></div>
    <div class="stat-card"><strong>${counts["已完成"]}</strong><span>已完成</span></div>
  `;
}

async function updateOrderStatus(orderId, status) {
  const { error } = await sb
    .from("orders")
    .update({
      order_status: status,
      updated_at: new Date().toISOString(),
    })
    .eq("id", orderId);

  if (error) {
    toast(`訂單狀態更新失敗：${error.message}`);
    return;
  }

  const target = state.orders.find((order) => order.id === orderId);
  if (target) target.order_status = status;

  renderOrders();
  toast("訂單狀態已更新");
}

/* =========================
   共用工具
========================= */

function openModal(id) {
  $(`#${id}`).classList.remove("hidden");
}

function closeModal(id) {
  $(`#${id}`).classList.add("hidden");
}

function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.remove("hidden");

  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => {
    el.classList.add("hidden");
  }, 2200);
}

function money(value) {
  const number = Number(value || 0);
  return new Intl.NumberFormat("zh-TW", {
    style: "currency",
    currency: "TWD",
    maximumFractionDigits: 0,
  }).format(number);
}

function formatDateTime(value) {
  if (!value) return "-";

  return new Intl.DateTimeFormat("zh-TW", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function parseTags(value) {
  if (!value) return [];

  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function nullIfEmpty(value) {
  const text = String(value || "").trim();
  return text ? text : null;
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function toInteger(value) {
  const number = parseInt(value, 10);
  return Number.isFinite(number) ? number : 0;
}

function getFileExt(name, type) {
  const raw = String(name || "").split(".").pop().toLowerCase();

  if (["jpg", "jpeg", "png", "webp"].includes(raw)) {
    return raw === "jpeg" ? "jpg" : raw;
  }

  if (type === "image/png") return "png";
  if (type === "image/webp") return "webp";
  return "jpg";
}

function safeRandomId() {
  if (window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }

  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}
