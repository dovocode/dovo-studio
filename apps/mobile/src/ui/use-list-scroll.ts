import { useCallback, useLayoutEffect, useRef, type RefObject } from 'react'
import type {
  FlatList,
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
} from 'react-native'
import { createListScroll } from './list-scroll'

function restoreList<T>(list: FlatList<T>, offset: number) {
  list.scrollToOffset({ offset, animated: false })
}

function restoreView(view: ScrollView, offset: number) {
  view.scrollTo({ y: offset, animated: false })
}

export function useListScroll<T>(saved: RefObject<number>, focused: boolean) {
  return useScrollRetention<FlatList<T>>(saved, focused, restoreList)
}

export function useScrollViewScroll(saved: RefObject<number>, focused: boolean) {
  return useScrollRetention(saved, focused, restoreView)
}

function useScrollRetention<T>(
  saved: RefObject<number>,
  focused: boolean,
  scrollTo: (view: T, offset: number) => void,
) {
  const controller = useRef<ReturnType<typeof createListScroll> | null>(null)
  const focus = useRef(focused)
  useLayoutEffect(() => {
    focus.current = focused
    controller.current?.setFocused(focused)
  }, [focused])
  const ref = useCallback(
    (view: T | null) => {
      controller.current = view ? createListScroll(saved, (offset) => scrollTo(view, offset)) : null
      controller.current?.setFocused(focus.current)
    },
    [saved, scrollTo],
  )
  return {
    ref,
    retainPosition: () => controller.current?.retainPosition(),
    onLayout: (event: LayoutChangeEvent) =>
      controller.current?.viewport(event.nativeEvent.layout.height),
    onContentSizeChange: (_width: number, height: number) => controller.current?.content(height),
    onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) =>
      controller.current?.scroll(event.nativeEvent.contentOffset.y),
    onScrollBeginDrag: () => controller.current?.beginDrag(),
    onScrollToTop: (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      controller.current?.beginDrag()
      controller.current?.scroll(event.nativeEvent.contentOffset.y)
    },
  }
}
