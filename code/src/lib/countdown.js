// The shared countdown derivation lives in frameserver/lib/countdown.mjs so
// the hub (which publishes the derived timer for the Apple TV) and every web
// screen run byte-identical logic. This re-export keeps app imports tidy;
// vite.config.js allows the dev server to read above code/.
export * from '../../../frameserver/lib/countdown.mjs'
