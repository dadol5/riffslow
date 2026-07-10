// 동영상 파일에서 오디오 트랙만 추출하는 모듈 (ffmpeg.wasm 사용)
//
// 왜 필요한가: 브라우저의 decodeAudioData는 순수 오디오 파일(mp3/m4a/wav)만 받고,
// 동영상 컨테이너(.mov/.mp4)는 아이폰 Safari조차 거절함 → ffmpeg로 먼저 오디오만 분리

import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile } from '@ffmpeg/util'
// ?url = 파일 내용이 아니라 "파일이 서빙되는 주소"를 가져오는 Vite 문법 (자체 호스팅)
import coreURL from '@ffmpeg/core?url'
import wasmURL from '@ffmpeg/core/wasm?url'

// ffmpeg 로딩은 무거우므로(~31MB) 앱 전체에서 1회만 수행하고 재사용
let ffmpegPromise: Promise<FFmpeg> | null = null

function getFFmpeg(): Promise<FFmpeg> {
  if (!ffmpegPromise) {
    ffmpegPromise = (async () => {
      const ff = new FFmpeg()
      await ff.load({ coreURL, wasmURL })
      console.log('ffmpeg 로딩 완료 (최초 1회)')
      return ff
    })()
  }
  return ffmpegPromise
}

// 동영상 → 오디오 Blob 추출
// 1차 시도: 오디오 트랙 무변환 복사 (재인코딩 없음 = 빠름, 아이폰 영상 AAC에 적합)
// 2차 시도: wav 변환 (특이 코덱 대비 — 느리지만 확실)
export async function extractAudio(file: File): Promise<Blob> {
  const ff = await getFFmpeg()

  // 입력 파일을 ffmpeg 가상 파일시스템에 기록
  const ext = file.name.match(/\.\w+$/)?.[0] ?? '.mov'
  const inputName = `input${ext}`
  await ff.writeFile(inputName, await fetchFile(file))

  try {
    // -vn: 비디오 제거 / -acodec copy: 오디오 무변환 복사
    const code = await ff.exec(['-i', inputName, '-vn', '-acodec', 'copy', 'out.m4a'])
    if (code === 0) {
      const data = (await ff.readFile('out.m4a')) as Uint8Array
      if (data.length > 0) {
        console.log(`오디오 추출 완료(복사): ${(data.length / 1024 / 1024).toFixed(1)}MB`)
        return new Blob([new Uint8Array(data)], { type: 'audio/mp4' })
      }
    }

    // 복사 실패 → wav로 변환 재시도
    console.warn('무변환 복사 실패 — wav 변환으로 재시도')
    const code2 = await ff.exec(['-i', inputName, '-vn', '-ac', '2', '-ar', '44100', 'out.wav'])
    if (code2 !== 0) {
      throw new Error('동영상에서 오디오를 추출하지 못했어요')
    }
    const data2 = (await ff.readFile('out.wav')) as Uint8Array
    console.log(`오디오 추출 완료(wav 변환): ${(data2.length / 1024 / 1024).toFixed(1)}MB`)
    return new Blob([new Uint8Array(data2)], { type: 'audio/wav' })
  } finally {
    // 가상 파일시스템 정리 (다음 추출을 위해 메모리 반환)
    for (const name of [inputName, 'out.m4a', 'out.wav']) {
      try {
        await ff.deleteFile(name)
      } catch {
        // 없는 파일 삭제 시도는 무시
      }
    }
  }
}
