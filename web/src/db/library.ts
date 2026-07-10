// 곡 라이브러리 저장소 — IndexedDB (idb 래퍼 사용)
//
// 스토어 2개 분리 구조:
// - 'tracks': 목록용 메타데이터 (제목/길이/곡별 설정) — 가벼움
// - 'files' : 오디오 원본 Blob — 무거움 (재생할 곡만 개별 로드)
// 분리 이유: 목록 조회 시 모든 곡의 Blob을 메모리에 올리지 않기 위해

import { openDB, type DBSchema, type IDBPDatabase } from 'idb'

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
}

export interface TrackMeta {
  id: number
  name: string
  duration: number // 곡 길이 (초)
  addedAt: number // 추가 시각 (타임스탬프)
  settings: TrackSettings
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
}

// DB 연결은 앱 전체에서 1회만 (이후 재사용)
let dbPromise: Promise<IDBPDatabase<LibraryDB>> | null = null

function getDB(): Promise<IDBPDatabase<LibraryDB>> {
  if (!dbPromise) {
    dbPromise = openDB<LibraryDB>('riffslow', 1, {
      // 최초 생성(또는 버전 업) 시 스토어 구성
      upgrade(db) {
        db.createObjectStore('tracks', { keyPath: 'id', autoIncrement: true })
        db.createObjectStore('files')
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

// 곡 삭제: 메타 + 파일 + 설정 모두 확실하게 제거 ⭐ (이 프로젝트의 존재 이유)
export async function deleteTrack(id: number): Promise<void> {
  const db = await getDB()
  await db.delete('tracks', id)
  await db.delete('files', id)
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
