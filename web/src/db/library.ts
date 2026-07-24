// 곡 라이브러리 저장소 — IndexedDB (idb 래퍼 사용)
//
// 스토어 3개 분리 구조:
// - 'tracks': 목록용 메타데이터 (제목/길이/곡별 설정) — 가벼움
// - 'files' : 오디오 원본 Blob — 무거움 (재생할 곡만 개별 로드)
// - 'stems' : 곡에 붙은 스템 파일들 (PC에서 분리한 WAV 등) — key = 곡 id
// 분리 이유: 목록 조회 시 모든 곡의 Blob을 메모리에 올리지 않기 위해

import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { ChordSegment } from '../audio/chords'
import type { Shape } from '../utils/voicings'

// 구간 루프: 여러 개 존재 가능, end가 null이면 시작점만 찍힌 미완성 루프
export interface Loop {
  start: number // 루프 시작 (초)
  end: number | null // 루프 끝 (초) — null = 아직 끝점 미지정
}

// 곡별 저장 설정 (원본 앱에 없는 개선 — 자동 저장/복원)
export interface TrackSettings {
  tempo: number // 템포 % (100 = 원속도)
  pitch: number // 피치 (반음 단위, ±12) — 구버전 저장 데이터엔 없을 수 있음 (?? 0 처리)
  loops: Loop[] // 구간 루프 목록 (구버전 데이터는 loopA/loopB 단일 루프 — 복원 시 변환)
  posMarkers: number[] // 위치 마커 목록 (초)
  trackS: number | null // 시작(S)/끝(E) 마커 (초)
  trackE: number | null
  // BPM 자동 분석 결과 (구버전 데이터엔 없음)
  // undefined = 아직 분석 안 함, null = 직전 분석 실패 — 둘 다 로드 시 재분석함
  bpm?: number | null
  bpmOffset?: number | null // 첫 박 위치 (초) — 메트로놈 그리드 기준점
  // 마디 첫박 위상 (0~3, bpmOffset 기준 박 인덱스 mod 4) — 첫박 탭/1박 밀기로 수동 지정
  // undefined = 미지정 (코드 구간 다수결로 추정 표시)
  barPhase?: number | null
  bpmVer?: number // BPM 분석 로직 버전 — 낮으면 로드 시 자동 재분석 (v2: 드럼 스템+소수점)
  // 코드/KEY 자동 분석 결과 (undefined/null 규칙은 bpm과 동일)
  chords?: ChordSegment[] | null
  songKey?: string | null // 예: "C minor"
  chordsVer?: number // 분석 로직 버전 — 로직이 개선되면 낮은 버전 데이터는 자동 재분석
  // 코드별로 고른 운지 (코드표 레이어 "같은 코드 전부 적용" — 키 = 표시 조 기준 코드명)
  // 구간별 지정(ChordSegment.shape)과 달리 재분석해도 유지됨
  chordShapes?: Record<string, Shape>
  // 코드를 수동으로 수정했는지 — true면 분석 로직이 업그레이드돼도 자동 재분석하지 않음 (수정 보존)
  chordsEdited?: boolean
  // 스템 믹서 상태 (스템 이름 → 볼륨 0~1 / 뮤트) — 솔로는 세션 한정이라 저장 안 함
  stemMix?: Record<string, { volume: number; muted: boolean }>
}

export interface TrackMeta {
  id: number
  name: string
  duration: number // 곡 길이 (초)
  addedAt: number // 추가 시각 (타임스탬프)
  settings: TrackSettings
  // 붙어있는 스템 이름 목록 (없으면 스템 없는 곡) — Blob 로드 없이 목록/배지 표시용
  stemNames?: string[]
}

// 곡에 붙는 스템 1개 (예: name='vocals', blob=분리된 WAV)
export interface StemFile {
  name: string
  blob: Blob
}

export function defaultSettings(): TrackSettings {
  return {
    tempo: 100,
    pitch: 0,
    loops: [],
    posMarkers: [],
    trackS: null,
    trackE: null,
  }
}

// DB 스키마 정의 (idb의 타입 지원 — 스토어별 키/값 타입 지정)
interface LibraryDB extends DBSchema {
  tracks: { key: number; value: TrackMeta }
  files: { key: number; value: Blob }
  stems: { key: number; value: StemFile[] }
}

// DB 연결은 앱 전체에서 1회만 (이후 재사용)
let dbPromise: Promise<IDBPDatabase<LibraryDB>> | null = null

function getDB(): Promise<IDBPDatabase<LibraryDB>> {
  if (!dbPromise) {
    dbPromise = openDB<LibraryDB>('riffslow', 2, {
      // 버전 업 시 기존 데이터는 유지하고 없는 스토어만 추가
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          db.createObjectStore('tracks', { keyPath: 'id', autoIncrement: true })
          db.createObjectStore('files')
        }
        if (oldVersion < 2) {
          db.createObjectStore('stems') // v2: 스템 파일 (key = 곡 id)
        }
      },
    })
  }
  return dbPromise
}

// 곡 추가: 메타 + 파일 저장, 생성된 메타 반환
export async function addTrack(
  name: string,
  file: Blob,
  duration: number,
): Promise<TrackMeta> {
  const db = await getDB()
  const meta = {
    name,
    duration,
    addedAt: Date.now(),
    settings: defaultSettings(),
  }
  // id는 autoIncrement로 자동 생성됨 (add가 생성된 키를 반환)
  const id = await db.add('tracks', meta as TrackMeta)
  await db.put('files', file, id)
  return { ...meta, id }
}

// 전체 곡 목록 (제목 오름차순 — 설계서 확정: 한글 로케일 가나다→ABC)
export async function getAllTracks(): Promise<TrackMeta[]> {
  const db = await getDB()
  const tracks = await db.getAll('tracks')
  return tracks.sort((a, b) => a.name.localeCompare(b.name, 'ko'))
}

// 곡 1개 메타 조회 (최신 설정 복원용)
export async function getTrack(id: number): Promise<TrackMeta | undefined> {
  const db = await getDB()
  return db.get('tracks', id)
}

// 곡 파일(Blob) 조회
export async function getTrackFile(id: number): Promise<Blob | undefined> {
  const db = await getDB()
  return db.get('files', id)
}

// 곡 삭제: 메타 + 파일 + 스템 + 설정 모두 확실하게 제거 ⭐ (이 프로젝트의 존재 이유)
export async function deleteTrack(id: number): Promise<void> {
  const db = await getDB()
  await db.delete('tracks', id)
  await db.delete('files', id)
  await db.delete('stems', id)
}

// 스템 저장: 곡에 붙임 (기존 스템은 통째로 교체) + 메타에 이름 목록 기록
export async function saveStems(id: number, stems: StemFile[]): Promise<void> {
  const db = await getDB()
  const meta = await db.get('tracks', id)
  if (!meta) throw new Error('스템을 붙일 곡을 찾을 수 없어요')
  await db.put('stems', stems, id)
  await db.put('tracks', { ...meta, stemNames: stems.map((s) => s.name) })
}

// 곡의 스템 목록 조회 (없으면 undefined)
export async function getStems(id: number): Promise<StemFile[] | undefined> {
  const db = await getDB()
  return db.get('stems', id)
}

// 곡별 설정 갱신 (자동 저장에서 호출)
export async function updateSettings(
  id: number,
  settings: TrackSettings,
): Promise<void> {
  const db = await getDB()
  const meta = await db.get('tracks', id)
  if (!meta) return // 삭제된 곡이면 무시
  await db.put('tracks', { ...meta, settings })
}
