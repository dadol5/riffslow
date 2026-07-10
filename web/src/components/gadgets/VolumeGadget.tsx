// G-01 Volume 가젯 — 마스터 볼륨 슬라이더 (빛나는 선, 원본 재현)
// AirPlay 버튼은 웹 제약으로 미지원 (설계서 확정)

interface VolumeGadgetProps {
  volume: number // 0~100
  onChange: (volume: number) => void
}

function VolumeGadget({ volume, onChange }: VolumeGadgetProps) {
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
    </div>
  )
}

export default VolumeGadget
