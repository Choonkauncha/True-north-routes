import {
  contentTypeFor,
  playbackDecision,
  extensionOf,
  slideCountFromNames,
  slideModel,
  resolveZipPath,
  storageLimitMessage,
  tusEndpoint,
  uploadSizeError
} from '../lib/training-progress.js';

const TUS_CHUNK = 6 * 1024 * 1024;

export function probeVideoFile(file) {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    const typed = file.slice(0, file.size, 'video/mp4');
    const url = URL.createObjectURL(typed);
    const canPlayType = video.canPlayType('video/mp4') || video.canPlayType(file.type || '');
    let settled = false;
    const finish = async () => {
      if (settled) return;
      settled = true;
      const videoWidth = video.videoWidth || 0;
      let played = false;
      if (videoWidth > 0) {
        try {
          const attempt = video.play();
          if (attempt) await attempt;
          played = !video.error;
          video.pause();
        } catch { played = false; }
      }
      URL.revokeObjectURL(url);
      resolve(playbackDecision({
        extension: extensionOf(file.name),
        canPlayType,
        videoWidth,
        played
      }));
    };
    video.onloadedmetadata = () => finish();
    video.onerror = () => finish();
    setTimeout(() => finish(), 8000);
    video.src = url;
  });
}

export function capturePoster(file) {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    const url = URL.createObjectURL(file.slice(0, file.size, 'video/mp4'));
    const done = (blob) => { URL.revokeObjectURL(url); resolve(blob); };
    video.onerror = () => done(null);
    video.onloadeddata = () => {
      const target = Math.min(0.5, (video.duration || 1) / 3);
      const draw = () => {
        if (!video.videoWidth) return done(null);
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        canvas.getContext('2d').drawImage(video, 0, 0);
        canvas.toBlob((blob) => done(blob), 'image/jpeg', 0.82);
      };
      if (target > 0) {
        video.onseeked = draw;
        video.currentTime = target;
      } else draw();
    };
    video.src = url;
  });
}

export async function transcodeToMp4(file, onProgress) {
  onProgress?.(1);
  const { FFmpeg } = await import('https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/esm/index.js');
  const { fetchFile, toBlobURL } = await import('https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.1/dist/esm/index.js');
  const ffmpeg = new FFmpeg();
  ffmpeg.on('progress', ({ progress }) => onProgress?.(Math.max(1, Math.round((progress || 0) * 100))));
  const base = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm';
  await ffmpeg.load({
    coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, 'application/wasm')
  });
  await ffmpeg.writeFile('input.mov', await fetchFile(file));
  const code = await ffmpeg.exec(['-i', 'input.mov', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', 'output.mp4']);
  if (code !== 0) throw new Error('This video uses a codec this browser cannot play, and the converter did not finish. Export it as H.264 MP4 and upload that.');
  const data = await ffmpeg.readFile('output.mp4');
  const blob = new Blob([data.buffer], { type: 'video/mp4' });
  const sizeError = uploadSizeError(blob.size);
  if (sizeError) throw new Error(sizeError);
  return blob;
}

export async function readPptx(file) {
  const JSZip = (await import('https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm')).default;
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const names = Object.keys(zip.files);
  const slides = names
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((a, b) => Number(a.match(/(\d+)/)[1]) - Number(b.match(/(\d+)/)[1]));
  const models = [];
  for (const name of slides) {
    const xml = await zip.files[name].async('string');
    const relName = name.replace('ppt/slides/', 'ppt/slides/_rels/') + '.rels';
    const rels = zip.files[relName] ? await zip.files[relName].async('string') : '';
    const model = slideModel(xml, rels);
    const images = [];
    for (const target of model.imageTargets) {
      const path = resolveZipPath(name.split('/').slice(0, -1).join('/') + '/', target);
      const entry = zip.files[path];
      if (!entry) continue;
      const blob = await entry.async('blob');
      images.push(URL.createObjectURL(blob));
    }
    models.push({ texts: model.texts, images });
  }
  return { slideCount: slideCountFromNames(names), slides: models };
}

async function pdfjs() {
  const lib = await import('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.6.82/build/pdf.min.mjs');
  lib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.6.82/build/pdf.worker.min.mjs';
  return lib;
}

export async function pdfPageCount(file) {
  const lib = await pdfjs();
  const doc = await lib.getDocument({ data: await file.arrayBuffer() }).promise;
  return doc.numPages;
}

export async function openPdf(src) {
  const lib = await pdfjs();
  const doc = await lib.getDocument({ url: src }).promise;
  return doc;
}

export async function renderPdfPage(doc, pageNumber, canvas) {
  const page = await doc.getPage(pageNumber);
  const width = canvas.parentElement?.clientWidth || 320;
  const base = page.getViewport({ scale: 1 });
  const scale = Math.max(0.2, width / base.width);
  const viewport = page.getViewport({ scale });
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  canvas.style.width = '100%';
  canvas.style.height = 'auto';
  await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
}

export function uploadTrainingFile({ file, objectName, contentType, supabaseUrl, accessToken, apikey, onProgress }) {
  const sizeError = uploadSizeError(file.size);
  if (sizeError) return Promise.reject(new Error(sizeError));
  return import('https://cdn.jsdelivr.net/npm/tus-js-client@4.2.3/lib.esm/browser/index.js').then(({ Upload }) => new Promise((resolve, reject) => {
    const upload = new Upload(file, {
      endpoint: tusEndpoint(supabaseUrl),
      retryDelays: [0, 1000, 3000, 5000],
      headers: {
        authorization: `Bearer ${accessToken}`,
        apikey,
        'x-upsert': 'true'
      },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      chunkSize: TUS_CHUNK,
      metadata: {
        bucketName: 'training',
        objectName,
        contentType: contentType || contentTypeFor(file.name || objectName),
        cacheControl: '3600'
      },
      onError(error) {
        reject(new Error(storageLimitMessage(error, file.size) || error?.message || 'Upload failed.'));
      },
      onProgress(sent, total) {
        onProgress?.(total ? Math.round((sent / total) * 100) : 0);
      },
      onSuccess() { resolve(objectName); }
    });
    upload.findPreviousUploads().then((previous) => {
      if (previous.length) upload.resumeFromPreviousUpload(previous[0]);
      upload.start();
    }).catch(reject);
  }));
}

export async function uploadPoster(sb, objectName, blob) {
  const { error } = await sb.storage.from('training').upload(objectName, blob, {
    contentType: 'image/jpeg',
    upsert: true
  });
  if (error) throw error;
  return objectName;
}
