import VideoToolbox
import CoreImage
import CoreVideo
import Foundation

let args = CommandLine.arguments
let inURL = URL(fileURLWithPath: args[1]), outURL = URL(fileURLWithPath: args[2])
let ctx = CIContext(options: [.workingColorSpace: CGColorSpace(name: CGColorSpace.linearSRGB)!])
let src = CIImage(contentsOf: inURL)!
let w = Int(src.extent.width), h = Int(src.extent.height)
guard let cfg = VTSuperResolutionScalerConfiguration(frameWidth: w, frameHeight: h, scaleFactor: 4, inputType: .image, usePrecomputedFlow: false, qualityPrioritization: .normal, revision: .revision1) else { fatalError("cfg") }

let sem = DispatchSemaphore(value: 0)
if cfg.configurationModelStatus != .ready {
  print("downloading model...")
  cfg.downloadConfigurationModel { err in if let e = err { print("dl error", e) }; sem.signal() }
  sem.wait()
  print("status", cfg.configurationModelStatus.rawValue)
}

func makeBuf(_ attrs: [String: Any]) -> CVPixelBuffer {
  let W = attrs[kCVPixelBufferWidthKey as String] as! Int, H = attrs[kCVPixelBufferHeightKey as String] as! Int
  let fmts = attrs[kCVPixelBufferPixelFormatTypeKey as String] as! [NSNumber]
  var pb: CVPixelBuffer?
  let r = CVPixelBufferCreate(nil, W, H, fmts[0].uint32Value, [kCVPixelBufferIOSurfacePropertiesKey as String: [:]] as CFDictionary, &pb)
  precondition(r == kCVReturnSuccess, "pb \(r)")
  return pb!
}
let t0 = Date()
let inBuf = makeBuf(cfg.sourcePixelBufferAttributes)
let outBuf = makeBuf(cfg.destinationPixelBufferAttributes)
let srgb = CGColorSpace(name: CGColorSpace.sRGB)!
ctx.render(src, to: inBuf, bounds: src.extent, colorSpace: srgb)

let proc = VTFrameProcessor()
do { try proc.startSession(configuration: cfg) } catch { fatalError("session \(error)") }
let sf = VTFrameProcessorFrame(buffer: inBuf, presentationTimeStamp: .zero)!
let df = VTFrameProcessorFrame(buffer: outBuf, presentationTimeStamp: .zero)!
let params = VTSuperResolutionScalerParameters(sourceFrame: sf, previousFrame: nil, previousOutputFrame: nil, opticalFlow: nil, submissionMode: .random, destinationFrame: df)!
let t1 = Date()
proc.process(parameters: params) { _, err in if let e = err { print("process error", e) }; sem.signal() }
sem.wait()
let t2 = Date()
proc.endSession()
let out = CIImage(cvPixelBuffer: outBuf, options: [.colorSpace: srgb])
try! ctx.writePNGRepresentation(of: out, to: outURL, format: .RGBA8, colorSpace: srgb)
print(String(format: "out %dx%d  inference %.2fs  total %.2fs", CVPixelBufferGetWidth(outBuf), CVPixelBufferGetHeight(outBuf), t2.timeIntervalSince(t1), Date().timeIntervalSince(t0)))
