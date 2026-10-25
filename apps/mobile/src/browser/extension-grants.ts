import type {
  ExtensionGrant,
  ExtensionPermissionReview,
  ExtensionPermissionPrompt,
} from './native-browser'

export function permissionChoices(review: ExtensionPermissionReview) {
  return {
    permissions: [
      ...new Set([...review.requestedPermissions, ...review.optionalPermissions]),
    ].filter((permission) => !review.unsupportedPermissions.includes(permission)),
    matchPatterns: [
      ...new Set([...review.requestedMatchPatterns, ...review.optionalMatchPatterns]),
    ],
  }
}
export function restrictGrant(
  grant: ExtensionGrant,
  review: ExtensionPermissionReview,
): ExtensionGrant {
  const allowed = permissionChoices(review)
  return {
    permissions: [...new Set(grant.permissions)].filter((value) =>
      allowed.permissions.includes(value),
    ),
    matchPatterns: [...new Set(grant.matchPatterns)].filter((value) =>
      allowed.matchPatterns.includes(value),
    ),
  }
}

/** URL-specific WebKit prompts expect the approved URLs in the matchPatterns grant field. */
export function permissionPromptChoices(prompt: ExtensionPermissionPrompt): ExtensionGrant {
  return {
    permissions: [...new Set(prompt.permissions)],
    matchPatterns: [...new Set([...prompt.matchPatterns, ...prompt.urls])],
  }
}
export function restrictPromptGrant(
  grant: ExtensionGrant,
  prompt: ExtensionPermissionPrompt,
): ExtensionGrant {
  const choices = permissionPromptChoices(prompt)
  return {
    permissions: [...new Set(grant.permissions)].filter((value) =>
      choices.permissions.includes(value),
    ),
    matchPatterns: [...new Set(grant.matchPatterns)].filter((value) =>
      choices.matchPatterns.includes(value),
    ),
  }
}
