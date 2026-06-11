import CoreGraphics

// PhotoCrop - faithful port of the crop math in PhotoSlideshow.jsx.
//
// Decides Fill (cover-crop) vs Fit (letterbox with blur) per photo + container,
// and for Fill computes a focus point that keeps detected faces in frame.

let SMART_FACES_CROP_LOSS_MAX = 0.40   // matches the web constant

// Fraction of the photo's area hidden if drawn object-fit:cover into container.
func coverCropLoss(photoW: Double, photoH: Double, containerW: Double, containerH: Double) -> Double {
    guard photoW > 0, photoH > 0, containerW > 0, containerH > 0 else { return 0 }
    let photoAR = photoW / photoH
    let containerAR = containerW / containerH
    if photoAR > containerAR {
        return 1 - containerAR / photoAR
    }
    return 1 - photoAR / containerAR
}

// Result of resolving a cell: fill with a unit focus point (0..1, 0..1), or fit.
struct CellPlan {
    enum Mode { case fill, fit }
    var mode: Mode
    var focusX: Double   // 0..1 (only meaningful for fill)
    var focusY: Double
}

// Compute the unit focus point that keeps the face union centered within the
// cover-crop window. Returns (focus, facesFit). When facesFit == false the
// face union is wider than the visible window and the caller should Fit.
private func computeFillFocus(
    photoW: Double, photoH: Double, containerW: Double, containerH: Double, faces: [PhotoFace]
) -> (x: Double, y: Double, facesFit: Bool) {
    guard !faces.isEmpty, photoW > 0, photoH > 0, containerW > 0, containerH > 0 else {
        return (0.5, 0.5, true)
    }
    let pA = photoW / photoH
    let cA = containerW / containerH

    // Which axis crops? Visible window extent on that axis (normalized).
    let axisX: Bool
    let wN: Double
    if pA > cA { axisX = true; wN = cA / pA } else { axisX = false; wN = pA / cA }

    var minE = Double.infinity, maxE = -Double.infinity
    for f in faces {
        let c = axisX ? f.cx : f.cy
        let half = axisX ? f.w / 2 : f.h / 2
        minE = min(minE, c - half)
        maxE = max(maxE, c + half)
    }
    if maxE - minE > wN + 1e-6 {
        return (0.5, 0.5, false)
    }
    let midpoint = (minE + maxE) / 2
    let idealStart = midpoint - wN / 2
    let start = max(0, min(1 - wN, idealStart))
    let posPct = wN < 1 ? start / (1 - wN) : 0.5
    return axisX ? (posPct, 0.5, true) : (0.5, posPct, true)
}

// Decide Fill vs Fit for a photo + container, factoring in Smart Faces.
// Mirrors resolveCell() in the web app.
func resolveCell(
    photoW: Double, photoH: Double, containerW: Double, containerH: Double,
    displayMode: String, smartThreshold: Double, smartFaces: Bool, faces: [PhotoFace]
) -> CellPlan {
    if displayMode == "fill" {
        if smartFaces {
            let f = computeFillFocus(photoW: photoW, photoH: photoH,
                                     containerW: containerW, containerH: containerH, faces: faces)
            return CellPlan(mode: .fill, focusX: f.x, focusY: f.y)
        }
        return CellPlan(mode: .fill, focusX: 0.5, focusY: 0.5)
    }
    if displayMode == "fit" {
        return CellPlan(mode: .fit, focusX: 0.5, focusY: 0.5)
    }
    // smart
    let loss = coverCropLoss(photoW: photoW, photoH: photoH, containerW: containerW, containerH: containerH)
    let hasFaces = smartFaces && !faces.isEmpty
    if hasFaces {
        let f = computeFillFocus(photoW: photoW, photoH: photoH,
                                 containerW: containerW, containerH: containerH, faces: faces)
        if !f.facesFit { return CellPlan(mode: .fit, focusX: 0.5, focusY: 0.5) }
        return loss > SMART_FACES_CROP_LOSS_MAX
            ? CellPlan(mode: .fit, focusX: 0.5, focusY: 0.5)
            : CellPlan(mode: .fill, focusX: f.x, focusY: f.y)
    }
    return loss > smartThreshold
        ? CellPlan(mode: .fit, focusX: 0.5, focusY: 0.5)
        : CellPlan(mode: .fill, focusX: 0.5, focusY: 0.5)
}
