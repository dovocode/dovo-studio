import { app, type Session } from 'electron'
import {
  browserLanguages,
  browserLinkProfile,
  browserProfilesSchema,
  browserWebsiteCustomizationScript,
  decodeResult,
} from '@dovo/protocol'
import { readLocalSettingsSection } from '@dovo/protocol/local-settings'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Schema } from 'effect'

const configured = new WeakMap<Session, string>()
const preferences = Schema.Struct({
  browserProfiles: browserProfilesSchema,
  browserWorkspaceEnabled: Schema.optional(Schema.Boolean),
})
export function websiteLinkProfile(sourceProfileId: string, url: string) {
  const result = decodeResult(preferences, readLocalSettingsSection('app'))
  return result.success && result.data.browserWorkspaceEnabled === true
    ? browserLinkProfile(url, result.data.browserProfiles, sourceProfileId)
    : undefined
}
export function websiteCustomization(profileId: string, url: string) {
  const result = decodeResult(preferences, readLocalSettingsSection('app'))
  const origin = new URL(url).origin
  return browserWebsiteCustomizationScript(
    result.success
      ? (result.data.browserProfiles
          .find((profile) => profile.id === profileId)
          ?.websites?.filter((site) => site.origin === origin) ?? [])
      : [],
  )
}
export function configureBrowserLanguage(session: Session, profileId: string, userAgent: string) {
  const result = decodeResult(preferences, readLocalSettingsSection('app'))
  const language = result.success
    ? result.data.browserProfiles.find((profile) => profile.id === profileId)?.language
    : undefined
  const languages = browserLanguages(language)
  session.setUserAgent(userAgent, languages.join(','))
  const signature = JSON.stringify(languages)
  if (configured.get(session) === signature) return
  const directory = join(app.getPath('userData'), 'browser-preloads')
  mkdirSync(directory, { recursive: true })
  const path = join(directory, `language-${languages[0]}.cjs`)
  writeFileSync(
    path,
    `const {contextBridge}=require('electron');contextBridge.executeInMainWorld({func:(languages)=>{Object.defineProperty(Navigator.prototype,'language',{get:()=>languages[0],configurable:true});Object.defineProperty(Navigator.prototype,'languages',{get:()=>Object.freeze([...languages]),configurable:true})},args:[${signature}]});`,
  )
  if (configured.has(session)) session.unregisterPreloadScript('dovo-browser-language')
  session.registerPreloadScript({ id: 'dovo-browser-language', type: 'frame', filePath: path })
  configured.set(session, signature)
}
