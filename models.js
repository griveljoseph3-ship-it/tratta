// Tratta — caricamento modelli GLB (Kenney, CC0) ottimizzati con meshopt + webp.
// loadAll(lista) -> cache; parts(nome) -> [{geometry (in coordinate del modello), material}] + bbox.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';

const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
const CACHE = {}, PENDING = {};
const MAT_CACHE = new Map();
// palette naturale per i materiali del Nature Kit (di serie sono turchesi)
const PALETTE = { leafsGreen: 0x4f8a2e, grass: 0x5d9436, leafsDark: 0x2f5c2c, dirt: 0x9a7354, woodBark: 0x6b4a30, woodBarkDark: 0x4e3424, stone: 0x8d8d88, _defaultMat: 0x8a8680, woodInner: 0xd9b98f };

export function load(path) {
  if (CACHE[path]) return Promise.resolve(CACHE[path]);
  return PENDING[path] ||= loader.loadAsync('./assets/' + path + '.glb').then(g => {
    const root = g.scene; root.updateMatrixWorld(true);
    root.traverse(o => { if (o.isMesh) { o.geometry.userData.shared = true; const m = o.material; if (PALETTE[m.name] != null) m.color.set(PALETTE[m.name]); if (m.map) { m.map.colorSpace = THREE.SRGBColorSpace; m.map.anisotropy = 4; } m.roughness = Math.max(.6, m.roughness ?? 1); m.metalness = Math.min(.15, m.metalness ?? 0); m.envMapIntensity = .45; } });
    const bb = new THREE.Box3().setFromObject(root);
    return CACHE[path] = { root, bb, size: bb.getSize(new THREE.Vector3()) };
  }).catch(e => { console.warn('modello', path, e.message || e); return CACHE[path] = null; });
}
export const loadAll = paths => Promise.all(paths.map(load));
export const get = p => CACHE[p];

// Geometrie fuse per materiale (coordinate del modello, già trasformate). Una draw call per materiale.
export function parts(path) {
  const M = CACHE[path]; if (!M) return null; if (M.parts) return M.parts;
  const byMat = new Map();
  M.root.traverse(o => { if (!o.isMesh) return; const g = o.geometry.clone();
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    for (const k of ['position', 'normal', 'uv']) { const a = g.attributes[k]; if (!a) continue; // quantizzati (KHR_mesh_quantization) -> float prima di trasformare
      if (a.normalized || !(a.array instanceof Float32Array) || a.isInterleavedBufferAttribute) { const n = a.itemSize, f = new Float32Array(a.count * n), get = [a.getX, a.getY, a.getZ, a.getW];
        for (let i = 0; i < a.count; i++) for (let j = 0; j < n; j++) f[i * n + j] = get[j].call(a, i); g.setAttribute(k, new THREE.BufferAttribute(f, n)); } }
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    g.applyMatrix4(o.matrixWorld);
    const key = o.material.uuid; if (!byMat.has(key)) byMat.set(key, { mat: o.material, list: [] }); byMat.get(key).list.push(g); });
  M.parts = [...byMat.values()].map(({ mat, list }) => { let geo; try { geo = list.length > 1 ? BufferGeometryUtils.mergeGeometries(list.map(g => g.index ? g : g), false) : list[0]; } catch (e) { geo = list[0]; } geo.userData.shared = true; return { geometry: geo, material: shareMat(mat) }; });
  return M.parts;
}
// Materiali identici (stesso colormap Kenney) condivisi tra modelli -> meno cambi di stato.
function shareMat(m) { const k = (m.map ? m.map.image?.src || m.map.uuid : '') + '|' + m.color.getHexString() + '|' + m.name; if (!MAT_CACHE.has(k)) MAT_CACHE.set(k, m); return MAT_CACHE.get(k); }
