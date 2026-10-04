import * as THREE from 'three'

// Earth is the shared center of the seven surrounding regions.
export function createCosmosEarth() {
  const globe = new THREE.Group()
  globe.name = 'earth-below'
  globe.position.set(0, -1750, 0)
  const radius = 1190
  const texture = new THREE.TextureLoader().load('/textures/earth-blue-marble.jpg')
  texture.colorSpace = THREE.SRGBColorSpace
  const surface = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 80, 56),
    new THREE.MeshPhongMaterial({ map: texture, color: '#8eacc6', shininess: 8 }),
  )
  surface.rotation.set(0, -1, Math.PI / 4)
  globe.add(surface)
  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(radius + 12, 64, 48),
    new THREE.ShaderMaterial({
      vertexShader: `
        varying vec3 vNormal, vView;
        void main() {
          vec4 view = modelViewMatrix * vec4(position, 1.0);
          vNormal = normalize(normalMatrix * normal);
          vView = normalize(-view.xyz);
          gl_Position = projectionMatrix * view;
        }`,
      fragmentShader: `
        varying vec3 vNormal, vView;
        void main() {
          float rim = pow(1.0 - max(dot(normalize(vNormal), normalize(vView)), 0.0), 5.0);
          gl_FragColor = vec4(.18, .48, 1.0, rim * .65);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  )
  globe.add(atmosphere)
  const light = new THREE.DirectionalLight('#e0edff', 1.8)
  light.position.set(-2400, 3500, 2100)
  light.target = globe
  const ambient = new THREE.AmbientLight('#7893c3', 0.3)
  return { globe, radius, light, ambient, dispose: () => texture.dispose() }
}
