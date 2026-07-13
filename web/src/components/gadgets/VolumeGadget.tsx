// G-01 Volume 가젯 — 음원(master) + 메트로놈 개별 볼륨 슬라이더 (빛나는 선, 원본 재현)
// AirPlay 버튼은 웹 제약으로 미지원 (설계서 확정)

interface VolumeGadgetProps {
  volume: number // 음원 볼륨 0~100
  metroVolume: number // 메트로놈 볼륨 0~100
  onChange: (volume: number) => void
  onMetroVolumeChange: (volume: number) => void
}

function VolumeGadget({ volume, metroVolume, onChange, onMetroVolumeChange }: VolumeGadgetProps) {
  return (
    <div className="volume-gadget">
      <input
        type="range"
        min={0}
        max={100}
        value={volume}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <div className="volume-label">master volume</div>

      <input
        type="range"
        min={0}
        max={100}
        value={metroVolume}
        onChange={(e) => onMetroVolumeChange(Number(e.target.value))}
      />
      <div className="volume-label">metronome volume</div>
    </div>
  )
}

export default VolumeGadget
