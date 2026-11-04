import { handleProducts } from "../../worker/products/service";
import type { ProductEnv } from "../../worker/products/taobao";

export const onRequest = (context: { request: Request; env: ProductEnv }) => handleProducts(context.request, context.env);
