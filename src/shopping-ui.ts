import { parseProductLink, productErrors, validShopping } from "./shopping";
const esc = (v: string) => v.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const time = (value: number) => new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
export function renderProductCards(value: unknown): string {
  const attachment = validShopping(value); if (!attachment) return "";
  return `<section class="shopping-cards" aria-label="本页商品资料">${attachment.results.map(result => {
    const product = result.product, link = parseProductLink(result.rawUrl);
    if (!product) return `<article class="shopping-card shopping-error"><strong>商品读取暂不可用${link.itemId ? ` · ${esc(link.itemId)}` : ""}</strong><p>${esc(productErrors[result.code ?? "UPSTREAM_ERROR"])}</p><small>本页读取失败不会影响正常聊天和 RP。</small></article>`;
    return `<article class="shopping-card" data-product-id="${esc(product.itemId)}" data-product-expires="${product.expiresAt}"><div class="shopping-product"><div class="shopping-image"><span aria-hidden="true">▧</span>${product.image ? `<img src="${esc(product.image)}" alt="${esc(product.title)}" loading="lazy" referrerpolicy="no-referrer" data-product-image>` : ""}</div><div class="shopping-facts"><small>${product.platform === "tmall" ? "天猫" : "淘宝"}</small><strong>${esc(product.title)}</strong><span class="shopping-price">${product.price ? `¥${esc(product.price)} <small>平台展示价</small>` : product.priceExpired ? "价格已过期，需重新查询" : "未取得可确认价格"}</span>${product.shopName ? `<span class="shopping-shop">${esc(product.shopName)}</span>` : ""}</div></div><small class="shopping-time">获取于 ${esc(time(product.fetchedAt))} · 非成交价保证</small><div class="shopping-card-actions"><a href="${esc(product.canonicalUrl)}" target="_blank" rel="noopener noreferrer">查看原商品 ↗</a></div>${product.unavailableFields.length ? `<details class="shopping-missing"><summary>未读取的资料</summary><p>${esc(product.unavailableFields.map(field => ({ image: "主图", price: "价格", originalPrice: "原价", shopName: "店铺", sku: "SKU 规格", attributes: "属性", description: "描述", reviews: "评价", stock: "库存" }[field] ?? field)).join("、"))}</p></details>` : ""}</article>`;
  }).join("")}</section>`;
}
export function expireProductCards(target: HTMLElement, now = Date.now()): void {
  target.querySelectorAll<HTMLElement>("[data-product-expires]").forEach(card => {
    if (Number(card.dataset.productExpires) > now) return;
    const price = card.querySelector<HTMLElement>(".shopping-price");
    if (price) price.textContent = "价格已过期，需重新查询";
  });
}
export function bindProductImages(target: HTMLElement): void {
  expireProductCards(target);
  target.querySelectorAll<HTMLImageElement>("[data-product-image]").forEach(image => {
    const failed = () => { image.hidden = true; image.parentElement?.setAttribute("aria-label", "商品图片暂不可用"); };
    image.addEventListener("error", failed, { once: true }); if (image.complete && !image.naturalWidth) failed();
  });
}
