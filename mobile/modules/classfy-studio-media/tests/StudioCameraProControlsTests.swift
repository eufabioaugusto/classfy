import Foundation

@main struct StudioCameraProControlsTests {
  static func require(_ valid:Bool, _ message:String = "") throws {
    if !valid { throw NSError(domain:"camera-pro",code:1,userInfo:[NSLocalizedDescriptionKey:message]) }
  }
  static func main() throws {
    let clamped = try StudioCameraProValues.validatedGains(red:-2,green:2.5,blue:40,maximum:4)
    try require(clamped.red==1 && clamped.green==2.5 && clamped.blue==4)
    let repeated=try StudioCameraProValues.validatedGains(red:clamped.red,green:clamped.green,blue:clamped.blue,maximum:4)
    try require(repeated.red==clamped.red && repeated.green==clamped.green && repeated.blue==clamped.blue)
    for (red,green,blue,maximum): (Float,Float,Float,Float) in [(.nan,1,1,4),(1,1,1,0),(1,.infinity,1,4)] {
      do { _=try StudioCameraProValues.validatedGains(red:red,green:green,blue:blue,maximum:maximum); throw NSError(domain:"expected-rejection",code:1) }
      catch StudioCameraProError.invalid {}
    }

    var conversions = 0
    let unavailableReadings: [(Float,Float,Float,Float)] = [
      (0,0,0,4), (0,1,1,4), (1,0,1,4), (1,1,0,4),
      (.nan,1,1,4), (1,.nan,1,4), (1,1,.nan,4),
      (.infinity,1,1,4), (1,1,-.infinity,4),
      (0.99,1,1,4), (4.01,1,1,4), (1,4.01,1,4), (1,1,4.01,4),
      (1,1,1,0), (1,1,1,0.99), (1,1,1,.nan), (1,1,1,.infinity)
    ]
    for (red,green,blue,maximum) in unavailableReadings {
      let reading = StudioCameraProValues.temperatureAndTintIfReady(supported:true,red:red,green:green,blue:blue,maximum:maximum) {
        conversions += 1
        return (5600,0)
      }
      try require(reading == nil,"Gains iniciais/inválidos não podem virar Kelvin confirmado")
    }
    let unsupported = StudioCameraProValues.temperatureAndTintIfReady(supported:false,red:1,green:2,blue:4,maximum:4) {
      conversions += 1
      return (5600,0)
    }
    try require(unsupported == nil && conversions == 0,"Nenhuma conversão AVFoundation com sensor inválido ou não suportado")
    let ready = StudioCameraProValues.temperatureAndTintIfReady(supported:true,red:1,green:2,blue:4,maximum:4) {
      conversions += 1
      return (5600,-7)
    }
    try require(ready?.temperature == 5600 && ready?.tint == -7 && conversions == 1,"Faixa inclusiva válida permite a leitura real")
    for (temperature,tint): (Float,Float) in [(0,0),(-1,0),(.nan,0),(.infinity,0),(5600,.nan),(5600,.infinity)] {
      let reading = StudioCameraProValues.temperatureAndTintIfReady(supported:true,red:1,green:2,blue:4,maximum:4) { (temperature,tint) }
      try require(reading == nil,"Conversão não finita não pode ser anunciada ao usuário")
    }

    // Auto WB, exposure-only and focus-only all have required=false. Invalid
    // initial gains/max must not be read, normalized or validated in this path.
    var preparations = 0
    for maximum:Float in [0,.nan,.infinity,4] {
      let auto = try StudioCameraProValues.manualGains(required:false,maximum:maximum) {
        preparations += 1
        return (.nan,0,.infinity)
      }
      try require(auto == nil && preparations == 0,"Auto/foco/exposição não dependem de gains manuais")
    }
    let manual = try StudioCameraProValues.manualGains(required:true,maximum:4) {
      preparations += 1
      return (-2,2.5,40)
    }
    try require(manual?.red == 1 && manual?.green == 2.5 && manual?.blue == 4 && preparations == 1,"Ganhos solicitados respeitam a faixa do setter")

    var currentReadings = 0
    let restored = try StudioCameraProValues.requestedTemperatureAndTint(temperature:6500,tint:-12) {
      currentReadings += 1
      return nil
    }
    try require(restored.temperature == 6500 && restored.tint == -12 && currentReadings == 0,"Configuração manual completa restaura sem converter gains iniciais")
    let bounded = try StudioCameraProValues.requestedTemperatureAndTint(temperature:12000,tint:-200) { nil }
    try require(bounded.temperature == 10000 && bounded.tint == -150,"Janela de ajuste do produto limita Kelvin/tint explícitos")
    let partial = try StudioCameraProValues.requestedTemperatureAndTint(temperature:6500,tint:nil) {
      currentReadings += 1
      return (5600,8)
    }
    try require(partial.temperature == 6500 && partial.tint == 8 && currentReadings == 1,"Ajuste parcial completa só o componente ausente com leitura real")
    let tintOnly = try StudioCameraProValues.requestedTemperatureAndTint(temperature:nil,tint:15) { (4300,-5) }
    try require(tintOnly.temperature == 4300 && tintOnly.tint == 15)
    for reading:StudioCameraProValues.TemperatureAndTint? in [nil,(0,0),(.nan,0),(5600,.infinity)] {
      do {
        _ = try StudioCameraProValues.requestedTemperatureAndTint(temperature:6500,tint:nil) { reading }
        throw NSError(domain:"expected-rejection",code:1)
      } catch StudioCameraProError.unsupported {}
    }
    for (temperature,tint): (Float?,Float?) in [(.nan,0),(5600,.infinity)] {
      do {
        _ = try StudioCameraProValues.requestedTemperatureAndTint(temperature:temperature,tint:tint) { nil }
        throw NSError(domain:"expected-rejection",code:1)
      } catch StudioCameraProError.invalid {}
    }
    print("PASS balanço inicial zero/NaN/fora da faixa não chama AVFoundation; leitura válida e restauração manual verificadas; Auto/foco/exposição independentes; limites de setter preservados")
  }
}
