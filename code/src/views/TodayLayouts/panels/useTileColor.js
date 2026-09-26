import { useEffect, useSyncExternalStore } from 'react'
import { artColorFor, pickTileColor, requestArtColor, subscribeArtColors, wantsArtColor } from '../lib/tileColor.js'

// useTileColor(countdown, from, artSrc) -> the colour of a countdown's
// art-above card, or null for the layout's accent (lib/tileColor.js): its
// marker colour, the colour of the picture it shows, its calendar's colour,
// in the order `from` says (the tileColorFrom knob: 'auto', 'marker',
// 'calendar').
//
// artSrc is the picture's URL while the card shows it, else null (an emoji,
// nothing, a picture that failed to load). The picture is read once per URL
// for the whole page, and only when its colour could be used: on 'auto',
// with no marker colour. Until it has been read the card wears the next
// colour in line and changes over once (CountdownCard.css eases it); a
// picture read before, on this card or another, is there from the start.
export default function useTileColor(countdown, from, artSrc) {
  const marker = countdown ? countdown.tileColor : null
  const want = !!artSrc && wantsArtColor(marker, from)
  const sampled = useSyncExternalStore(subscribeArtColors, () => (want ? artColorFor(artSrc) : undefined))
  useEffect(() => {
    if (want) requestArtColor(artSrc)
  }, [want, artSrc])
  return pickTileColor({ marker, sampled, calendar: countdown ? countdown.color : null }, from)
}
