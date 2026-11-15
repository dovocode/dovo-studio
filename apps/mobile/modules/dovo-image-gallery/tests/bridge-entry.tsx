// Isolated Expo fixture. Bundle this entry only in a separate simulator app.
import { registerRootComponent, requireNativeView, requireOptionalNativeModule } from 'expo'
import { Directory, File, Paths } from 'expo-file-system'
import React, { useState } from 'react'
import { Button, Text, View, type ViewProps } from 'react-native'

const nativeModule = requireOptionalNativeModule('DovoImageGallery')
type Image = { id: string; name: string; uri?: string; error?: string }
const Gallery = nativeModule
  ? requireNativeView<
      ViewProps & {
        images: Image[]
        selectedID: string
        editable: boolean
        labels: Record<string, string>
        onSelect: (event: { nativeEvent: { id: string } }) => void
        onRetry: (event: { nativeEvent: { id: string } }) => void
        onEdit: (event: { nativeEvent: { id: string } }) => void
        onClose: () => void
      }
    >('DovoImageGallery')
  : null
const directory = new Directory(Paths.cache, 'image-gallery', 'expo-bridge')
directory.create({ intermediates: true, idempotent: true })
const file = new File(directory, 'bridge.png')
const initial: Image[] = [
  { id: 'one', name: 'First image.png', uri: file.uri },
  { id: 'two', name: 'Second image.png', uri: file.uri },
  { id: 'three', name: 'Recover image.png', error: 'Download failed' },
]
function Fixture() {
  const [selectedID, select] = useState('two')
  const [images, setImages] = useState(initial)
  const [event, setEvent] = useState('Bridge ready')
  return (
    <View style={{ flex: 1, paddingTop: 60 }}>
      <Text accessibilityLabel="Bridge status">{nativeModule ? event : 'MODULE MISSING'}</Text>
      <Button title="Show failed image" onPress={() => select('three')} />
      <Button
        title="Show invalid bytes"
        onPress={() => {
          const broken = new File(directory, 'broken.png')
          void broken.write('invalid image').then(
            () => {
              setImages(
                images.map((image) =>
                  image.id === 'three'
                    ? { id: 'three', name: 'Recover image.png', uri: broken.uri }
                    : image,
                ),
              )
              select('three')
            },
            (error: unknown) => setEvent(String(error)),
          )
        }}
      />
      {Gallery && (
        <Gallery
          style={{ flex: 1 }}
          images={images}
          selectedID={selectedID}
          editable
          labels={{
            close: 'Close preview',
            share: 'Share file',
            save: 'Save',
            edit: 'Edit',
            retry: 'Retry',
          }}
          onSelect={({ nativeEvent }) => {
            select(nativeEvent.id)
            setEvent(`Selected ${nativeEvent.id}`)
          }}
          onRetry={({ nativeEvent }) => {
            setEvent(`Retried ${nativeEvent.id}`)
            setImages(
              images.map((image) =>
                image.id === nativeEvent.id ? { ...image, uri: file.uri, error: undefined } : image,
              ),
            )
          }}
          onEdit={({ nativeEvent }) => setEvent(`Edit ${nativeEvent.id}`)}
          onClose={() => setEvent('Closed')}
        />
      )}
    </View>
  )
}
void file
  .write(
    'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAO0lEQVR4nO3RQREAMAjEwKNCKrvqEFMJ4cMvK+CYCXVfZ9NZXY8HBvwBMhEyETIRMhEyETIRMhEyUcgHf24B0LyCYcQAAAAASUVORK5CYII=',
    { encoding: 'base64' },
  )
  .then(
    () => registerRootComponent(Fixture),
    (error: unknown) => registerRootComponent(() => <Text>{String(error)}</Text>),
  )
