import * as THREE from 'three'

// Pin-sized cores with soft halos. Distance affects size; contribution amounts never do.
export function pointMaterial(size: number, opacity: number, perspective = 0) {
  return new THREE.ShaderMaterial({
    uniforms: {
      size: { value: size },
      opacity: { value: opacity },
      pixelRatio: { value: 1 },
      perspective: { value: perspective },
    },
    vertexShader: `
      uniform float size, pixelRatio, perspective;
      attribute vec3 tint;
      attribute float scale;
      varying vec3 vTint;
      varying float vFade;
      void main() {
        vTint = tint;
        vec4 view = modelViewMatrix * vec4(position, 1.0);
        float attenuation = perspective > 0.0 ? clamp(perspective / max(1.0, -view.z), .4, 1.65) : 1.0;
        vFade = smoothstep(2.0, 18.0, -view.z);
        gl_Position = projectionMatrix * view;
        gl_PointSize = size * scale * pixelRatio * attenuation;
      }`,
    fragmentShader: `
      uniform float opacity;
      varying vec3 vTint;
      varying float vFade;
      void main() {
        float d = length(gl_PointCoord - .5) * 2.0;
        if (d > 1.0) discard;
        float light = exp(-d * d * 32.0) + .14 * exp(-d * d * 5.5);
        gl_FragColor = vec4(vTint, light * opacity * vFade);
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
}

// A continuous distant sky wraps around the camera. Nearby stars stay in world space.
export function nebulaMaterial() {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    vertexShader: `
      varying vec3 vDirection;
      void main() {
        vDirection = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      varying vec3 vDirection;
      float hash(vec3 p) {
        p = fract(p * .3183099 + vec3(.11, .23, .37));
        p *= 17.0;
        return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
      }
      float noise(vec3 p) {
        vec3 i = floor(p), f = fract(p);
        f = f*f*(3.0-2.0*f);
        return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),
          mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
          mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),
          mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);
      }
      float fbm(vec3 p) {
        float n = 0.0, a = .5;
        for (int i = 0; i < 5; i++) {
          n += a * noise(p);
          p = p * 2.03 + vec3(13.1, 7.3, 5.7);
          a *= .5;
        }
        return n;
      }
      void main() {
        vec3 d = normalize(vDirection);
        float latitude = dot(d, normalize(vec3(.55, .83, .15)));
        float cloud = fbm(d * 7.0 + 8.0);
        float fine = fbm(d * 36.0 + cloud * 3.0);
        float band = exp(-pow((latitude + (cloud-.5)*.32) * 4.0, 2.0));
        float spine = exp(-pow((latitude + (fine-.5)*.15) * 13.0, 2.0));
        float dust = smoothstep(.37, .68, fbm(d * 19.0 + 23.0));
        float glow = band * (.22 + cloud) * fine * (1.0-dust*.9);
        vec3 cold = vec3(.055, .074, .11);
        vec3 warm = vec3(.11, .079, .052);
        vec3 tint = mix(cold, warm, smoothstep(-.8, .7, d.x));
        vec3 color = vec3(.0008, .0012, .0024) + tint * glow;
        color += vec3(.045, .05, .065) * spine * fine * (1.0-dust) * .45;
        gl_FragColor = vec4(color, 1.0);
        #include <colorspace_fragment>
      }`,
  })
}

export function disposeObject(object: THREE.Object3D) {
  object.traverse((child) => {
    if ('geometry' in child) (child.geometry as THREE.BufferGeometry).dispose()
    if ('material' in child) {
      const materials = child.material as THREE.Material | THREE.Material[]
      for (const material of Array.isArray(materials) ? materials : [materials]) material.dispose()
    }
  })
}
