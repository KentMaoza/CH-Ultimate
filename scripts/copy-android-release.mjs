import { copyFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const source = resolve('android/app/build/outputs/apk/release/app-release.apk');
const destination = resolve('out/android/CHU-Companion-Mobile-0.1.4-release.apk');

try {
  await mkdir(resolve('out/android'), { recursive: true });
  await copyFile(source, destination);
  console.log(`Copied signed release APK to ${destination}`);
} catch (error) {
  const reason = error instanceof Error ? error.message : String(error);
  console.error(`Unable to copy release APK from ${source}: ${reason}`);
  process.exitCode = 1;
}
