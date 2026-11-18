export {
  usePullReviewSource,
  pullReviewRepositories,
  resolvePullReviewSource,
} from './pull-review-source'
export { prReviewIllustration } from '@dovo/design'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  pullFindingText,
  randomUUID,
  type PullCodeReview,
  type PullCodeReviewDraft,
  type PullCodeReviewReport,
  type PullCodeReviewTarget,
  type TitleGenerationSettings,
  type PullReviewDepth,
  type PullReviewImage,
  MAX_PULL_REVIEW_IMAGES,
  MAX_ATTACHMENT_BYTES,
} from '@dovo/protocol'

type Request = (path: string, input: unknown) => Promise<PullCodeReviewReport>
type Draft = { value: PullCodeReviewDraft; version: number }

const activityLabels = {
  preparing: 'Preparing review…',
  checks: 'Running project checks…',
  checking: 'Checking proposed findings…',
  combining: 'Combining reviewer findings…',
  reviewing: 'Reviewing captured evidence…',
  completed: 'Reviewing captured evidence…',
}

export function pullReviewActivity(review?: PullCodeReview, reviewers = 1) {
  const phase = review?.checks?.some((check) => check.status === 'running')
    ? 'checks'
    : (review?.analysis?.phase ?? 'preparing')
  const completed = review?.analysis?.completedBatches ?? 0
  const batches = review?.analysis?.batches ?? 0
  return {
    phase,
    label: activityLabels[phase],
    completed,
    batches,
    count: Math.max(1, Math.min(4, review?.reviewerResults?.length ?? reviewers)),
    activeBatch: review?.analysis?.activeBatch ?? Math.min(completed + 1, batches),
    percent: batches ? Math.min(100, (completed / batches) * 100) : 0,
  }
}

// Retain unsaved text across navigation. Saved text lives on the owning computer.
const drafts = new Map<string, Draft>()
const imagesByScope = new Map<string, PullReviewImage[]>()
const starts = new Map<string, { fingerprint: string; requestId: string }>()

export function usePullCodeReview({
  target,
  scope,
  request,
  connected,
}: {
  target: PullCodeReviewTarget
  scope: string
  request: Request
  connected: boolean
}) {
  const key = JSON.stringify([scope, target])
  const live = useRef(key)
  live.current = key
  const [state, setState] = useState<{ key: string; report: PullCodeReviewReport }>()
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [dirty, setDirty] = useState(0)
  const [selected, setSelected] = useState('')
  const [depth, setDepth] = useState<PullReviewDepth>()
  const [runChecks, setRunChecks] = useState(false)
  const [, updateImages] = useState(0)
  const images = imagesByScope.get(key) ?? []
  const setImages = (next: PullReviewImage[]) => {
    imagesByScope.set(key, next)
    updateImages((n) => n + 1)
  }
  const addImages = (next: PullReviewImage[]) => {
    const combined = [...(imagesByScope.get(key) ?? []), ...next]
    if (
      combined.length > MAX_PULL_REVIEW_IMAGES ||
      combined.some((image) => image.data.length > Math.ceil(MAX_ATTACHMENT_BYTES / 3) * 4) ||
      combined.reduce((n, image) => n + Math.floor((image.data.length * 3) / 4), 0) >
        10 * 1024 * 1024
    )
      throw new Error('Attach up to three images, 5 MB each and 10 MB in total.')
    setImages(combined)
  }
  const saving = useRef<Promise<boolean> | undefined>(undefined)
  const submitting = useRef(false)
  const operation = useRef(false)
  const report = state?.key === key ? state.report : undefined
  const review = report?.reviews.find((item) => item.id === selected) ?? report?.reviews[0]
  const draftKey = review ? `${key}:${review.id}` : ''
  const pending = drafts.get(draftKey)
  const draft = pending?.value ?? review?.draft
  const command = useCallback(
    async (action: string, input: object = {}) => {
      if (!connected) return false
      if (action === 'publish') {
        if (submitting.current) return false
        submitting.current = true
        setPublishing(true)
      }
      try {
        const next = await request(`/api/review/pull/${action}`, { target, ...input })
        if (live.current === key) {
          setState((previous) => {
            if (previous?.key !== key) return { key, report: next }
            const reviews = new Map(previous.report.reviews.map((review) => [review.id, review]))
            const stacks = new Map(previous.report.stacks?.map((stack) => [stack.id, stack]))
            for (const stack of next.stacks ?? []) {
              const held = stacks.get(stack.id)
              if (!held || stack.sequence >= held.sequence) stacks.set(stack.id, stack)
            }
            for (const review of next.reviews) {
              const held = reviews.get(review.id)
              if (!held || review.sequence >= held.sequence) reviews.set(review.id, review)
            }
            return {
              key,
              report: {
                ...next,
                stacks: [...stacks.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
                reviews: [...reviews.values()].sort((a, b) =>
                  b.createdAt.localeCompare(a.createdAt),
                ),
              },
            }
          })
          if (action !== 'read') setError('')
        }
        return next
      } catch (error) {
        if (live.current === key) setError(error instanceof Error ? error.message : String(error))
        return false
      } finally {
        if (action === 'publish') {
          submitting.current = false
          if (live.current === key) setPublishing(false)
        }
      }
    },
    [key, request, connected],
  )
  useEffect(() => {
    if (!connected) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    const read = async () => {
      const result = await command('read')
      if (!stopped)
        timer = setTimeout(
          read,
          result &&
            (result.reviews.some((r) => r.status === 'running') ||
              result.stacks?.some((stack) => stack.status === 'running'))
            ? 1500
            : 20_000,
        )
    }
    void read()
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [command])
  const save = useCallback(async () => {
    if (!review) return false
    if (saving.current && !(await saving.current)) return false
    const entry = drafts.get(draftKey)
    if (!entry) return true
    const task = (async () => {
      const result = await command('save', {
        reviewId: review.id,
        version: entry.version,
        draft: entry.value,
      })
      if (!result) return false
      const saved = result.reviews.find((r) => r.id === review.id)
      if (!saved) {
        setError(
          'The saved report is unavailable. Your draft is kept. Refresh before trying again.',
        )
        return false
      }
      const current = drafts.get(draftKey)
      if (current === entry) drafts.delete(draftKey)
      else if (current && saved) drafts.set(draftKey, { ...current, version: saved.version })
      setDirty((n) => n + 1)
      return !drafts.has(draftKey)
    })()
    saving.current = task
    try {
      return await task
    } finally {
      if (saving.current === task) saving.current = undefined
    }
  }, [command, draftKey, review?.id])
  useEffect(() => {
    if (!pending || !connected) return
    const timer = setTimeout(() => void save(), 500)
    return () => clearTimeout(timer)
  }, [dirty, pending, save, connected])
  const edit = (change: Partial<PullCodeReviewDraft>) => {
    if (!review || review.publication) return
    const before = drafts.get(draftKey)
    drafts.set(draftKey, {
      value: { ...(before?.value ?? review.draft), ...change },
      version: before?.version ?? review.version,
    })
    setDirty((n) => n + 1)
  }
  const start = async (
    selection: TitleGenerationSettings,
    headSha: string,
    baseSha: string,
    remaining = false,
    options: {
      depth: PullReviewDepth
      runChecks: boolean
      reviewers?: TitleGenerationSettings[]
      images?: PullReviewImage[]
      fullStack?: boolean
    } = {
      depth: 'standard',
      runChecks: false,
    },
  ) => {
    if (operation.current || !report) return
    operation.current = true
    setBusy(true)
    try {
      if (review && !(await save())) return
      const settings = {
        ...options,
        ...(report.oneRunSettingsSupported ? { oneRunSettings: true } : {}),
      }
      const fingerprint = JSON.stringify([
        selection,
        headSha,
        baseSha,
        remaining && review?.id,
        settings,
      ])
      let attempt = starts.get(key)
      if (!attempt || attempt.fingerprint !== fingerprint) {
        attempt = { fingerprint, requestId: randomUUID() }
        starts.set(key, attempt)
      }
      const result = await command('start', {
        requestId: attempt.requestId,
        selection,
        headSha,
        baseSha,
        ...settings,
        ...(remaining && review ? { remainingFrom: review.id } : {}),
      })
      if (result) {
        starts.delete(key)
        if (live.current === key)
          setSelected(result.reviews.find((r) => r.requestId === attempt.requestId)?.id ?? '')
      }
    } finally {
      operation.current = false
      setBusy(false)
    }
  }
  const add = (finding: PullCodeReview['findings'][number]) => {
    if (!draft) return
    setNotice('')
    if (draft.selected.includes(finding.id)) {
      const text = pullFindingText(finding)
      const index = draft.body.indexOf(text)
      const end = index + text.length
      const unchanged =
        index >= 0 &&
        (index === 0 || draft.body.slice(index - 2, index) === '\n\n') &&
        (end === draft.body.length || draft.body.slice(end, end + 2) === '\n\n')
      const body =
        index === 0
          ? draft.body.slice(end + (end < draft.body.length ? 2 : 0))
          : draft.body.slice(0, index - 2) + draft.body.slice(end)
      edit({
        selected: draft.selected.filter((id) => id !== finding.id),
        body: unchanged ? body : draft.body,
      })
      if (!unchanged)
        setNotice(
          'Finding removed from the selection. Any edited text remains in your draft. Remove that text in the editor if needed.',
        )
      return
    }
    const body = [draft.body, pullFindingText(finding)].filter(Boolean).join('\n\n')
    if (body.length > 50000) {
      setError('The draft is full. Shorten it before adding another finding.')
      return
    }
    edit({
      selected: [...draft.selected, finding.id],
      body,
    })
  }
  return {
    report,
    images,
    setImages,
    addImages,
    depth: depth ?? report?.depth ?? 'standard',
    setDepth,
    runChecks,
    setRunChecks,
    review,
    draft,
    error,
    notice,
    busy,
    publishing,
    dirty: !!pending,
    select: async (id: string) => {
      if (await save()) setSelected(id)
    },
    edit,
    add,
    start,
    save,
    command,
    refresh: async () => {
      const result = await command('read')
      if (result) setError('')
      return result
    },
    preparePreview: async () => {
      if (!review || operation.current) return
      operation.current = true
      setBusy(true)
      try {
        if (!(await save())) return
        const result = await command('read')
        const saved = result && result.reviews.find((item) => item.id === review.id)
        if (saved && !drafts.has(draftKey)) return saved
      } finally {
        operation.current = false
        if (live.current === key) setBusy(false)
      }
    },
    copyDraft: (from: PullCodeReview) => {
      if (!draft?.body.trim() && !from.publication) {
        edit({ body: from.draft.body, event: from.draft.event, selected: [] })
        setNotice(
          `Copied the draft from ${from.headSha.slice(0, 7)}. Check its findings and line references against this pass.`,
        )
      }
    },
    reloadDraft: () => {
      drafts.delete(draftKey)
      setDirty((n) => n + 1)
      void command('read')
    },
    replaceSavedDraft: () => {
      const entry = drafts.get(draftKey)
      if (entry && review) {
        drafts.set(draftKey, { ...entry, version: review.version })
        setDirty((n) => n + 1)
      }
    },
    draftConflict: !!pending && !!review && pending.version < review.version,
  }
}
