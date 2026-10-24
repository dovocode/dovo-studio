import { useMemo } from 'react'
import { View } from 'react-native'
import { toolImageReferences, toolImages, toolPresentation } from '@dovo/protocol'
import { ServerImage } from '../../../ui/content/server-image'

export function ToolResultImages({
  event,
}: {
  event: { id: string; scope: string; payload: string; summary: string; inputPayload?: string }
}) {
  const references = useMemo(
    () => toolImageReferences(event.payload, event.id),
    [event.payload, event.id],
  )
  const images = useMemo(
    () => (references.length ? [] : toolImages(event.payload)),
    [event.payload, references],
  )
  const label = toolPresentation(event.payload, event.summary, event.inputPayload).title
  if (!references.length && !images.length) return null
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {references.map((reference, index) => (
        <ServerImage
          compact
          taskId={event.scope}
          key={`${reference.eventId}:${reference.index}`}
          source={{ taskId: event.scope, reference }}
          label={`${label} image ${index + 1}`}
        />
      ))}
      {images.map((image, index) => (
        <ServerImage
          compact
          taskId={event.scope}
          key={index}
          source={{ uri: image.uri }}
          label={`${label} image ${index + 1}`}
        />
      ))}
    </View>
  )
}
