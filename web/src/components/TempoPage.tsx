// P-02 Tempo Wheel 페이지 — 템포 조절 + 재생 컨트롤
import TempoWheel from './TempoWheel'

interface TempoPageProps {
  tempo: number // 템포 %
  hasTrack: boolean
  isPlaying: boolean
  onTempoChange: (percent: number) => void
  onTogglePlay: () => void
}

function TempoPage({ tempo, hasTrack, isPlaying, onTempoChange, onTogglePlay }: TempoPageProps) {
  return (
    <TempoWheel
      tempo={tempo}
      hasTrack={hasTrack}
      isPlaying={isPlaying}
      onTempoChange={onTempoChange}
      onTogglePlay={onTogglePlay}
    />
  )
}

export default TempoPage
