---
title: "Frame Cabling: Picking the HDMI Connector for the Kitchen Panel"
created: 2026-08-18
modified: 2026-08-19
version: 1.2
author: Claude Opus 5 (claude-opus-5)
tags: [design, kitchen-display, hardware, hdmi, frame, raspberry-pi, ddc]
---

# Frame Cabling: Picking the HDMI Connector for the Kitchen Panel

**Status: Option B ordered 2026-08-18, arriving 2026-08-20.** Twozoh 4K Micro HDMI
to HDMI 1 ft braided cable, plus the AreMe 8K 90 degree Mini HDMI to HDMI adapter
2 pack in the **up and down** bend. Up/down is the correct orientation for a side
edge port in a shallow frame: it turns the cable to run along the panel edge
rather than forward into the mat or backward into depth we do not have. Not yet
fitted or verified, see the checklist at the end.

How to get video from the Pi into the EVICIV panel with a connector low enough to
disappear inside a wooden frame, without breaking the resolution, the aspect
ratio, or the DDC/CI backlight control that the display schedule now depends on.

Open item this closes: "Find the right HDMI cable for the kitchen screen" in
`BACKLOG.md` and `STATUS.md`.

## The two devices in play

Pulled from the PRD's locked hardware decisions and confirmed live on the Pi
(2026-08-18).

| | Device | Video connector | Notes |
| --- | --- | --- | --- |
| Source | Raspberry Pi 5 Model B Rev 1.1, 8GB (Vemico kit, 27W PSU) | 2x **micro HDMI, Type D** | In use: `HDMI-A-1`, the port nearest the USB-C power jack |
| Sink | EVICIV 15.6" touchscreen, ASIN B0CYLTZSWD | 1x **mini HDMI, Type C** (plus 2x USB-C and an OTG port) | 1920x1080 IPS, 10-point capacitive touch, panel body about 0.4 in thick |

So the cable you are shopping for is **micro HDMI Type D male at the Pi end, mini
HDMI Type C male at the panel end.** Straight micro-to-mini cables do exist in
short lengths (see the shopping list below), but **no right-angle version of
that pairing is sold by anyone.** Every stock right-angle HDMI cable or adapter
is mini-to-standard or micro-to-standard. That is the gap, and it is why the
build has to be either two pieces or the DIY ribbon parts.

Touch is a separate path and is already working: the panel's controller shows up
as a `SiS HID Touch Controller` on USB bus 003, so one USB-C on the panel is
cabled back to a USB-A port on the Pi. The panel's other USB-C carries its own
power. Whatever you do to the HDMI run, those two also have to survive the frame,
and they are the ones that actually set your minimum depth, because a USB-C plug
body is thicker than a right-angle HDMI plug.

## Measured baseline: the link you have right now is good

Read directly off `smartdisplay.local` on 2026-08-18, with the current cable
connected. **Do not lose this state.** It is the reference for judging any
replacement.

| Check | Reading | Meaning |
| --- | --- | --- |
| `/sys/class/drm/card1-HDMI-A-1/status` | `connected` | Hot plug detect (pin 19) is live |
| EDID length | **256 bytes** | Base block plus one CEA-861 extension, both read cleanly |
| EDID header | `00 ff ff ff ff ff ff 00`, vendor `RTK` | Valid, Realtek scaler |
| Preferred detailed timing | pixel clock 148.50 MHz, 1920x1080 | The panel's true native mode is being reported |
| `wlr-randr` active mode | `1920x1080 @ 60 Hz (preferred, current)` | The Pi picked native, no scaling, no stretch |
| `ddcutil detect` | Display 1 on `/dev/i2c-13`, VCP 2.2 | DDC/CI I2C is alive |
| `ddcutil getvcp 10` | current 60, max 100 | Brightness control is answering |

Two things worth flagging from that run:

- `cmdline.txt` currently has **no `video=` override**. The Pi is choosing 1080p
  purely from the EDID it reads over the cable. That works today, and it is also
  exactly why a marginal cable can change your resolution.
- `vcgencmd get_throttled` returned `0x50000`: under-voltage and throttling have
  occurred at some point since boot, though neither is active now. Keep an eye on
  it while you rework the power routing in the frame.

## Why the earlier cable combos went widescreen

An HDMI connector carries 19 conductors. Three of them have nothing to do with
picture and everything to do with your symptom:

- **Pin 19, Hot Plug Detect.** Tells the Pi a display exists at all.
- **Pins 15 and 16, DDC clock and data.** A two-wire I2C bus. The Pi reads the
  panel's EDID over these, and EDID is where "my native mode is 1920x1080" lives.

Cheap flat ribbons and stacked adapters are perfectly capable of passing the four
high-speed TMDS pairs well enough to make a picture while mangling that little
I2C bus, because the I2C lines are usually the ones left unshielded, unterminated,
or squeezed to the outside of the ribbon. When the EDID read fails or returns
garbage, the KMS driver on the Pi 5 does not give up and blank. It falls back to
a generic mode, often 1024x768 or 1280x720. The panel then stretches that
across its physical 16:9 glass, and you get the "widescreen" look. The picture is
fine. The handshake is what broke.

That also explains why the failure looked random across combos: it tracks signal
integrity on two specific wires, not whether the cable "works."

## The part that is specific to this project

`ddcutil` talks over **those same pins 15 and 16**. As of 2026-08-18 this display
depends on that:

- Phase A: the evening dim drives the real backlight with `setvcp 10`.
- Phase B: "off" genuinely powers the panel down with `setvcp D6`.

See `docs/designs/hardware-brightness-ddc.md`. So a cable that passes video but
degrades DDC will not just look fine and misbehave at night, it will look like a
software regression in the display schedule. Any candidate cable has to be judged
on `ddcutil detect` succeeding, not only on the picture coming up.

This is the requirement that rules out most ultra-thin ribbon solutions, and it is
worth knowing before you buy anything else.

## Requirements for the cable

1. Micro HDMI Type D male to mini HDMI Type C male.
2. All 19 conductors present, explicitly including 15, 16 and 19.
3. Shielded, ideally per-pair. Prefer a real coax bundle in a flat jacket over an
   unshielded flex ribbon.
4. As short as physically possible. Signal integrity problems on this class of
   cable scale hard with length, and you only need to reach the Pi.
5. Right angle at the panel end, with the bend **in the plane of the panel back**
   so the cable runs along the edge rather than out toward the wall or forward
   into the mat.
6. Able to survive being captured inside a wooden frame, including the mating
   forces when you close the frame up.

## Options, ranked

### Option A: Adafruit DIY HDMI Cable Parts (what is in your photos)

The small PCBs with the white FFC latches are Adafruit's DIY HDMI system: a plug
adapter board at each end joined by a flat ribbon. The pieces you would need for
this build:

| Part | ID | Price |
| --- | --- | --- |
| Right Angle (R Bend) Micro HDMI Plug | 3557 | $6.50 |
| Right Angle (L Bend) Micro HDMI Plug | 3558 | $6.50 |
| Right Angle (R bend) Mini HDMI Plug | 3553 | $6.50 |
| Right Angle (L Bend) Mini HDMI Plug | 3554 | $6.50 |
| Ribbon cable, 10 cm | 3560 | $1.50 |
| Ribbon cable, 20 cm | 3561 | $1.95 |
| Ribbon cable, 30 cm | 3562 | $2.75 |

R bend and L bend differ only in which way the cable exits, so the pair you want
depends on how the Pi sits relative to the panel. Buy one of each bend at both
ends if you are not sure. At $6.50 a piece that is cheap insurance against a
second order.

This is the lowest-profile option that exists, and it is the only one that is
genuinely micro-to-mini in a single run. The catch is the one Adafruit states
itself: these are "not going to be as durable or shielded as ready-made cables."
The same ribbon part is sold for USB and HDMI both, which tells you it is a
generic flex, not a characterized HDMI cable. **Use the shortest ribbon that
reaches, 10 cm if at all possible.** This is almost certainly the family that
gave you the aspect ratio problems, and length is the variable most likely to
have caused it.

### Option B: right-angle mini adapter plus a thin micro-to-standard cable (recommended)

Buy a low-profile **mini HDMI male to standard HDMI female right-angle adapter**
in aluminium, then run a thin, properly shielded **micro HDMI to standard HDMI**
cable from it back to the Pi. Right-angle mini adapters are sold in up/down and
left/right variants, which gives you the same orientation freedom as the Adafruit
bends.

This is bulkier at the panel edge than Option A, but every conductor stays inside
real shielded connectors and a real shielded cable, so DDC is far more likely to
be solid. Given that hardware dimming and hardware power-off both ride on DDC,
that tradeoff is worth a few extra millimetres. Start here.

### Option C: slim flat mini-to-standard cable plus a micro adapter at the Pi

A "thin" or "ultra slim" mini HDMI to standard HDMI cable, ideally one with a
right-angle mini end, plus a right-angle micro HDMI adapter at the Pi. Slim flat
HDMI cables are still real coax bundles in a flat jacket, so they are electrically
in a different class from an unshielded flex ribbon. Fewer mated pairs than
Option B. Worth considering if you find one in a 1 ft length with the right bend.

**Avoid:** stacking multiple passive adapters in series, and any cable or adapter
that does not clearly state HDMI compliance. Every extra mated pair is another
chance for the DDC lines to go marginal.

## Shopping list

Links gathered 2026-08-18. These are listings found by search, not parts that have
been tested on this panel: stock, revisions and seller quality all drift, and no
listing states whether its adapter passes DDC cleanly. Treat the verification
checklist below as the real acceptance test.

Bend direction cannot be settled until you test fit, so where a multi-pack covers
both orientations, buy that rather than guessing.

### Option A: Adafruit DIY HDMI parts (lowest profile)

| Part | ID | Price | Link |
| --- | --- | --- | --- |
| Right Angle (R Bend) Micro HDMI Plug | 3557 | $6.50 | https://www.adafruit.com/product/3557 |
| Right Angle (L Bend) Micro HDMI Plug | 3558 | $6.50 | https://www.adafruit.com/product/3558 |
| Right Angle (R bend) Mini HDMI Plug | 3553 | $6.50 | https://www.adafruit.com/product/3553 |
| Right Angle (L Bend) Mini HDMI Plug | 3554 | $6.50 | https://www.adafruit.com/product/3554 |
| Ribbon cable, 10 cm | 3560 | $1.50 | https://www.adafruit.com/product/3560 |
| Ribbon cable, 20 cm | 3561 | $1.95 | https://www.adafruit.com/product/3561 |

One micro plug plus one mini plug plus one ribbon makes a cable. Buying both bends
at both ends is about $26 and removes a second order from the critical path.

### Option B: right-angle mini adapter at the panel plus a micro-to-standard cable (recommended)

Panel end, pick by which way the cable must exit:

- Left and right bend, 3 pack, AreMe: https://www.amazon.com/AreMe-Adapter-Raspberry-Camcorder-Projector/dp/B0BRVZNLTF
- Up and down bend, 2 pack, AreMe: https://www.amazon.com/AreMe-Converter-Connector-Raspberry-Camcorder/dp/B0BWXSJG3W
- Left and right bend, 4 pack, flat profile: https://www.amazon.com/Adapter-L-Shaped-Converter-Connector-Raspberry/dp/B0DYDSV9QY
- Up and down bend, 4 pack: https://www.amazon.com/Adapter-L-Shaped-Converter-Connector-Raspberry/dp/B0DYDRR3D9

Pi end, standard HDMI to micro HDMI, 1 ft:

- Twozoh 4K Micro HDMI to HDMI 1 ft, braided, foil and braid shielded, bare copper: https://www.amazon.com/Micro-HDMI-to-Cable/dp/B0969MRFRR
- Thsucords Thin Micro HDMI to HDMI 1 ft, 2 pack, ultra slim and flexible: https://us.amazon.com/Thsucords-Micro-HDMI-Cable/dp/B0FR47BM9V

The Twozoh is the one to start with: it is the only listing here that actually
states foil-and-braid shielding, which is the property that protects the DDC pins.
Take the Thsucords instead only if the Twozoh proves too stiff to route.

### Option C: direct micro-to-mini, straight

- ZeniKon 4K Micro HDMI to Mini HDMI 1 ft, male to male, braided, sold for exactly
  this use case (Pi 5 to portable monitor):
  https://www.amazon.com/ZeniKon-Micro-HDMI-Mini-Cable/dp/B0DP6WTVN5

Electrically this is the best of the three: one continuous shielded cable, zero
mated pairs, nothing for DDC to degrade across. The only problem is the straight
plug at the panel, which sticks out sideways past the panel edge and will foul the
frame rail unless there is room in the rebate.

Worth buying regardless, even if it does not end up in the frame. At 1 ft it is a
known-good reference cable: if a candidate build misbehaves, swapping this in tells
you instantly whether the fault is the cable or something else.

### Not available

A right-angle micro-to-mini cable. It does not exist as a stock part from any
vendor checked. If a listing appears to offer one, read carefully, since micro and
mini get confused constantly in these listings.

## Belt and braces: lock the mode on the Pi

Independent of which cable wins, pin the output mode so a marginal EDID read can
never silently change your geometry again. On Pi 5 with the KMS driver, the old
`config.txt` `hdmi_group` and `hdmi_mode` settings are ignored. The current
mechanism is `cmdline.txt`.

Append to the **existing single line** in `/boot/firmware/cmdline.txt`, not a new
line:

```
video=HDMI-A-1:1920x1080@60D
```

`HDMI-A-1` is the micro HDMI port nearest the USB-C power jack, which is the one
in use. The `D` suffix forces HDMI mode rather than DVI.

Two caveats, both important:

- This locks resolution and refresh. It does **not** fix DDC. `ddcutil` still
  needs pins 15 and 16 to be electrically sound, so this is a safety net for the
  picture, not a substitute for a good cable.
- Do this **after** you settle on a cable, not before. While you are testing
  candidates, an unforced mode is a useful diagnostic: if a cable is bad you want
  to see it fall back, rather than have the override paper over it.

## Verification checklist for any candidate cable

Run all of these. A cable passes only if every line matches.

```bash
ssh pi@smartdisplay.local
```

```bash
cat /sys/class/drm/card1-HDMI-A-1/status          # expect: connected
wc -c < /sys/class/drm/card1-HDMI-A-1/edid        # expect: 256, not 0 or 128
head -1 /sys/class/drm/card1-HDMI-A-1/modes       # expect: 1920x1080
XDG_RUNTIME_DIR=/run/user/1000 WAYLAND_DISPLAY=wayland-0 wlr-randr
ddcutil detect --brief                            # expect: Display 1, RTK
ddcutil --bus 13 getvcp 10                        # expect: a value, no error
```

The `wlr-randr` line must report `1920x1080 px, 60.000000 Hz (preferred, current)`.
An EDID of 128 bytes instead of 256 means the CEA extension block failed to read,
which is a marginal cable even if the picture looks right.

Then leave it running for a full day. DDC failures under a frame are often
thermal or mechanical, not immediate, and the dim and off transitions at night are
the real test. Confirm the evening dim and the overnight power-off both still
drive the panel.

Last, do the verification **with the frame assembled**, not on the bench. Clamping
a ribbon or pressing a right-angle plug against wood can change the electrical
picture, and a cable that passes loose on the counter can fail once it is captured.

## Open decision

Which bend direction each end needs, which depends on where the Pi mounts relative
to the panel and which way the cable has to exit to clear the frame rebate. Worth
measuring the available depth behind the panel and the clearance at the port edge
before ordering, since bend orientation is the one thing you cannot fix after the
fact.
