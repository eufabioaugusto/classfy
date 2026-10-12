import Foundation

@main struct StudioCameraProControlsTests {
  static func require(_ valid:Bool) throws { if !valid { throw NSError(domain:"camera-pro",code:1) } }
  static func main() throws {
    let clamped = try StudioCameraProValues.validatedGains(red:-2,green:2.5,blue:40,maximum:4)
    try require(clamped.red==1 && clamped.green==2.5 && clamped.blue==4)
    let repeated=try StudioCameraProValues.validatedGains(red:clamped.red,green:clamped.green,blue:clamped.blue,maximum:4)
    try require(repeated.red==clamped.red && repeated.green==clamped.green && repeated.blue==clamped.blue)
    for (red,green,blue,maximum): (Float,Float,Float,Float) in [(.nan,1,1,4),(1,1,1,0),(1,.infinity,1,4)] {
      do { _=try StudioCameraProValues.validatedGains(red:red,green:green,blue:blue,maximum:maximum); throw NSError(domain:"expected-rejection",code:1) }
      catch StudioCameraProError.invalid {}
    }
    print("PASS gains de Kelvin/tint ficam em 1...max real; NaN/Inf/faixa inválida rejeitados sem abrir dispositivo")
  }
}
