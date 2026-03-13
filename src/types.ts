export type Provider = 'netease'

export interface SongItem {
  id: string
  provider: Provider
  cover: string
  title: string
  artist: string
  album: string
  durationSec: number
}
