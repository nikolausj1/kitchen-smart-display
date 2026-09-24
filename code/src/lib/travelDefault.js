// travelDefault - decide the morning's default travel mode (walking vs driving)
// from the forecast at departure time.
//
// The logic moved into lib/countdown.js (the shared
// frameserver/lib/countdown.mjs): the hub now computes the house travelDefault
// once, for every screen, from the same code a screen uses as its fallback
// before the hub has answered. Re-exported so existing imports keep working.
export { COLD_THRESHOLD_F, PRECIP_CODES, decideTravelMode } from './countdown.js'
