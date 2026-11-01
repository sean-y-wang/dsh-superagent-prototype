import { describe, expect, it } from 'vitest'
import { feishuApplinkHost, feishuChannelLabel, FeishuBrandSchema, isIxunfeiBrand } from '../src/infra/feishu-brand.ts'
import { feishuChatLink, feishuLink } from '../src/sources/feishu-channel.ts'
import { key } from '../src/core/index.ts'

describe('i讯飞 / Feishu brand', () => {
  it('maps applink hosts for feishu, lark, and xfchat', () => {
    expect(feishuApplinkHost('feishu')).toBe('feishu.cn')
    expect(feishuApplinkHost('lark')).toBe('larksuite.com')
    expect(feishuApplinkHost('xfchat.iflytek.com')).toBe('xfchat.iflytek.com')
    expect(feishuChatLink('xfchat.iflytek.com', 'oc_dev')).toBe(
      'https://applink.xfchat.iflytek.com/client/chat/open?openChatId=oc_dev')
  })
  it('accepts xfchat brand in auth-status schema', () => {
    expect(FeishuBrandSchema.parse('xfchat.iflytek.com')).toBe('xfchat.iflytek.com')
    expect(FeishuBrandSchema.parse('feishu')).toBe('feishu')
    expect(() => FeishuBrandSchema.parse('not a host')).toThrow()
  })
  it('labels i讯飞 channel links', () => {
    expect(isIxunfeiBrand('xfchat.iflytek.com')).toBe(true)
    expect(feishuChannelLabel('xfchat.iflytek.com')).toEqual({ zh: 'i讯飞消息', en: 'iFlytek IM message' })
    expect(feishuLink({ chatId: 'oc_1', messageId: 'om_1' }, {
      feishu: { cli: '/bin/false', appId: 'cli_x', brand: 'xfchat.iflytek.com', botId: 'ou_bot', name: '调度助手' },
    })).toEqual({
      url: 'https://applink.xfchat.iflytek.com/client/chat/open?openChatId=oc_1',
      label: { zh: 'i讯飞消息', en: 'iFlytek IM message' },
      triggerId: key('feishu', 'om_1'),
    })
  })
})
