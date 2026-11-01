/** Feishu / Lark / i讯飞 (xfchat) brand helpers for OpenAPI CLI and AppLinks. */
import { z } from 'zod'

/** Public Feishu, international Lark, and iFlytek privatized Feishu (i讯飞 / xfchat). */
export const FEISHU_BRANDS = ['feishu', 'lark', 'xfchat.iflytek.com'] as const
export type KnownFeishuBrand = (typeof FEISHU_BRANDS)[number]
/** Resolved brand from lark-cli `auth status`; private deployments may report a custom host. */
export type FeishuBrand = KnownFeishuBrand | (string & {})

const DOMAIN = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/i
/** Accepts feishu / lark / xfchat.iflytek.com, or another hostname-like private brand. */
export const FeishuBrandSchema = z.string().trim().min(1).refine(
  value => (FEISHU_BRANDS as readonly string[]).includes(value) || DOMAIN.test(value),
  'brand must be feishu, lark, xfchat.iflytek.com, or a hostname',
).default('feishu')

/** AppLink host for opening a chat in the client that matches the OpenAPI brand. */
export function feishuApplinkHost(brand: string): string {
  if (brand === 'lark') return 'larksuite.com'
  if (brand === 'feishu' || brand === '') return 'feishu.cn'
  if (brand === 'xfchat.iflytek.com') return 'xfchat.iflytek.com'
  return brand.replace(/^open\./i, '')
}

export const isIxunfeiBrand = (brand: string): boolean =>
  brand === 'xfchat.iflytek.com' || brand.endsWith('.xfchat.iflytek.com') || brand.includes('xfchat.iflytek.com')

export const feishuChannelLabel = (brand: string): { zh: string; en: string } =>
  isIxunfeiBrand(brand)
    ? { zh: 'i讯飞消息', en: 'iFlytek IM message' }
    : { zh: '飞书消息', en: 'Feishu message' }
