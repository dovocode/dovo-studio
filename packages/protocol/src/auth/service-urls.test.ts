import { expect, it } from 'vite-plus/test'
import {
  ACCOUNT_DIRECTORY_URL,
  connectServiceOrigin,
  normalizeServiceUrls,
} from './service-urls.js'

it('normalizes optional custom services while preserving private HTTP artifact storage', () => {
  expect(normalizeServiceUrls({ connectOrigin: '', artifactsOrigin: '' })).toEqual({
    connectOrigin: ACCOUNT_DIRECTORY_URL,
    artifactsOrigin: '',
  })
  expect(
    normalizeServiceUrls({
      connectOrigin: ' https://CONNECT.example.com/ ',
      artifactsOrigin: 'http://100.64.1.2:8082/',
    }),
  ).toEqual({
    connectOrigin: 'https://connect.example.com',
    artifactsOrigin: 'http://100.64.1.2:8082',
  })
  expect(connectServiceOrigin('http://127.0.0.1:8081')).toBe('http://127.0.0.1:8081')
  for (const connectOrigin of [
    'https://user:secret@connect.example.com',
    'https://connect.example.com/api',
    'https://connect.example.com?token=x',
    'https://connect.example.com#x',
    'http://connect.example.com',
    'file:///tmp',
  ])
    expect(() => normalizeServiceUrls({ connectOrigin, artifactsOrigin: '' })).toThrow(
      'Use an HTTPS Connect URL',
    )
  for (const artifactsOrigin of [
    'https://user:secret@artifacts.example.com',
    'https://artifacts.example.com/share',
    'https://artifacts.example.com?token=x',
  ])
    expect(() => normalizeServiceUrls({ connectOrigin: '', artifactsOrigin })).toThrow(
      'Use an HTTP or HTTPS artifact URL',
    )
})
