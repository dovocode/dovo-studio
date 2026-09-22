import { router } from 'expo-router'
import { Keyboard } from 'react-native'

export function issueHref(runtimeId: string, repositoryId: string, itemId: string, url?: string) {
  return {
    pathname: '/issues/item/[runtimeId]/[repositoryId]/[itemId]' as const,
    params: { runtimeId, repositoryId, itemId, ...(url ? { url } : {}) },
  }
}

export function jiraIssueHref(runtimeId: string, sourceId: string, itemId: string, url?: string) {
  return {
    pathname: '/issues/jira/[runtimeId]/[sourceId]/[itemId]' as const,
    params: { runtimeId, sourceId, itemId, ...(url ? { url } : {}) },
  }
}

export function pipelineHref(
  runtimeId: string,
  repositoryId: string,
  itemId: string,
  url?: string,
) {
  return {
    pathname: '/pulls/pipeline/[runtimeId]/[repositoryId]/[itemId]' as const,
    params: { runtimeId, repositoryId, itemId, ...(url ? { url } : {}) },
  }
}

export function pipelineRunsHref(
  runtimeId: string,
  repositoryId: string,
  sha: string,
  pull: number,
) {
  return {
    pathname: '/pulls/runs/[runtimeId]/[repositoryId]' as const,
    params: { runtimeId, repositoryId, sha, pull: String(pull) },
  }
}

export function pullHref(runtimeId: string, repositoryId: string, number: number) {
  return {
    pathname: '/pulls/pr/[runtimeId]/[repositoryId]/[number]' as const,
    params: { runtimeId, repositoryId, number: String(number) },
  }
}

export function automationHref(runtimeId: string, automationId: string) {
  return {
    pathname: '/jobs/automation/[runtimeId]/[automationId]' as const,
    params: { runtimeId, automationId },
  }
}

export function backToCollection(path: '/issues' | '/pulls' | '/jobs') {
  Keyboard.dismiss()
  if (router.canGoBack()) router.back()
  else router.replace(path)
}
