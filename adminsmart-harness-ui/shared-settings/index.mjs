/** 独立包根使官方 ClientModules 能注册唯一 wrapper 身份，Host 实现只维护一份。 */
export { Config, inject, apply, OFFICIAL_SETTINGS_CLIENT_ROUTE, OFFICIAL_SETTINGS_CLIENT_REVISION } from '../src/shared-settings.mjs'
