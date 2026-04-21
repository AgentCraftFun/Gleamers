'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import {
  VRM,
  VRMExpressionPresetName,
  VRMLoaderPlugin,
  VRMUtils,
} from '@pixiv/three-vrm';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Lipsync, VISEMES } from 'wawa-lipsync';
import * as THREE from 'three';

import type { AvatarExpression, VRMAvatarProps } from './types';

type Status = 'loading' | 'ready' | 'error';

const VISEME_TO_VRM: Partial<Record<VISEMES, VRMExpressionPresetName>> = {
  [VISEMES.aa]: VRMExpressionPresetName.Aa,
  [VISEMES.I]: VRMExpressionPresetName.Ih,
  [VISEMES.U]: VRMExpressionPresetName.Ou,
  [VISEMES.E]: VRMExpressionPresetName.Ee,
  [VISEMES.O]: VRMExpressionPresetName.Oh,
};

const EXPRESSION_TO_VRM: Record<
  Exclude<AvatarExpression, 'neutral'>,
  VRMExpressionPresetName
> = {
  happy: VRMExpressionPresetName.Happy,
  angry: VRMExpressionPresetName.Angry,
  surprised: VRMExpressionPresetName.Surprised,
  thinking: VRMExpressionPresetName.Sad,
  laughing: VRMExpressionPresetName.Happy,
};

const MOUTH_SHAPES: VRMExpressionPresetName[] = [
  VRMExpressionPresetName.Aa,
  VRMExpressionPresetName.Ih,
  VRMExpressionPresetName.Ou,
  VRMExpressionPresetName.Ee,
  VRMExpressionPresetName.Oh,
];

const EMOTION_SHAPES: VRMExpressionPresetName[] = [
  VRMExpressionPresetName.Happy,
  VRMExpressionPresetName.Angry,
  VRMExpressionPresetName.Sad,
  VRMExpressionPresetName.Surprised,
  VRMExpressionPresetName.Relaxed,
];

const EXPRESSION_HOLD_MS = 2000;

interface AvatarMeshProps {
  vrm: VRM;
  audioElement: HTMLAudioElement | null | undefined;
  expression: AvatarExpression;
  isSleeping: boolean;
}

function AvatarMesh({
  vrm,
  audioElement,
  expression,
  isSleeping,
}: AvatarMeshProps) {
  const lipsyncRef = useRef<Lipsync | null>(null);
  const activeExpressionRef = useRef<AvatarExpression>('neutral');
  const expressionQueueRef = useRef<AvatarExpression[]>([]);
  const expressionUntilRef = useRef(0);
  const blinkNextRef = useRef(0);
  const blinkEndRef = useRef(0);
  const { scene } = useThree();

  useEffect(() => {
    scene.add(vrm.scene);
    return () => {
      scene.remove(vrm.scene);
    };
  }, [scene, vrm]);

  // Connect lipsync when audio element shows up.
  useEffect(() => {
    if (!audioElement) {
      lipsyncRef.current = null;
      return;
    }
    const ls = new Lipsync();
    try {
      ls.connectAudio(audioElement);
      lipsyncRef.current = ls;
    } catch (err) {
      console.error('lipsync connect failed', err);
    }
    return () => {
      lipsyncRef.current = null;
    };
  }, [audioElement]);

  // Queue new incoming expressions (skip 'neutral'; treat as interrupt).
  useEffect(() => {
    if (expression === 'neutral') return;
    if (performance.now() < expressionUntilRef.current) {
      expressionQueueRef.current.push(expression);
    } else {
      activeExpressionRef.current = expression;
      expressionUntilRef.current = performance.now() + EXPRESSION_HOLD_MS;
    }
  }, [expression]);

  useFrame((_, delta) => {
    const em = vrm.expressionManager;
    const humanoid = vrm.humanoid;
    if (!em || !humanoid) return;

    const now = performance.now();
    const t = now / 1000;

    // --- Breathing (spine Y rotation + chest X tilt) --------------------
    const breathFreq = isSleeping ? 0.3 : 0.9;
    const breathAmp = isSleeping ? 0.015 : 0.03;
    const chest = humanoid.getNormalizedBoneNode('chest');
    if (chest) {
      chest.rotation.x = Math.sin(t * breathFreq * Math.PI) * breathAmp;
    }

    // --- Head sway + sleep tilt ----------------------------------------
    const head = humanoid.getNormalizedBoneNode('head');
    if (head) {
      if (isSleeping) {
        head.rotation.x = THREE.MathUtils.lerp(head.rotation.x, 0.5, 0.08);
        head.rotation.y = THREE.MathUtils.lerp(head.rotation.y, 0, 0.1);
        head.rotation.z = THREE.MathUtils.lerp(head.rotation.z, 0.15, 0.08);
      } else {
        head.rotation.x = THREE.MathUtils.lerp(
          head.rotation.x,
          Math.sin(t * 0.4) * 0.04,
          0.1,
        );
        head.rotation.y = THREE.MathUtils.lerp(
          head.rotation.y,
          Math.sin(t * 0.25) * 0.08,
          0.1,
        );
        head.rotation.z = THREE.MathUtils.lerp(
          head.rotation.z,
          Math.sin(t * 0.3) * 0.02,
          0.1,
        );
      }
    }

    // --- Blinks ---------------------------------------------------------
    if (isSleeping) {
      em.setValue(VRMExpressionPresetName.Blink, 1);
    } else {
      if (now >= blinkNextRef.current && blinkEndRef.current === 0) {
        blinkEndRef.current = now + 140;
        blinkNextRef.current = now + 2500 + Math.random() * 3500;
      }
      if (blinkEndRef.current > 0) {
        const remaining = blinkEndRef.current - now;
        if (remaining <= 0) {
          em.setValue(VRMExpressionPresetName.Blink, 0);
          blinkEndRef.current = 0;
        } else {
          const pct = 1 - Math.abs(70 - remaining) / 70;
          em.setValue(VRMExpressionPresetName.Blink, Math.max(0, pct));
        }
      } else {
        em.setValue(VRMExpressionPresetName.Blink, 0);
      }
    }

    // --- Expression hold + queue ---------------------------------------
    if (now >= expressionUntilRef.current) {
      const next = expressionQueueRef.current.shift();
      if (next) {
        activeExpressionRef.current = next;
        expressionUntilRef.current = now + EXPRESSION_HOLD_MS;
      } else {
        activeExpressionRef.current = 'neutral';
      }
    }

    // Reset emotion shapes, then set the active one.
    for (const shape of EMOTION_SHAPES) em.setValue(shape, 0);
    const active = activeExpressionRef.current;
    if (active !== 'neutral') {
      const preset = EXPRESSION_TO_VRM[active];
      em.setValue(preset, 1);
    }

    // --- Lip sync (or closed mouth when sleeping) -----------------------
    for (const shape of MOUTH_SHAPES) em.setValue(shape, 0);
    if (!isSleeping && lipsyncRef.current) {
      try {
        lipsyncRef.current.processAudio();
        const viseme = lipsyncRef.current.viseme as VISEMES | undefined;
        if (viseme) {
          const preset = VISEME_TO_VRM[viseme];
          if (preset) em.setValue(preset, 0.85);
        }
      } catch (err) {
        // wawa throws if the audio isn't actually playing — swallow it
      }
    }

    em.update();
    vrm.update(delta);
  });

  return null;
}

interface SceneProps extends VRMAvatarProps {
  onStatusChange: (status: Status) => void;
}

function Scene({
  vrmUrl,
  audioElement,
  expression = 'neutral',
  isSleeping = false,
  onStatusChange,
}: SceneProps) {
  const [vrm, setVrm] = useState<VRM | null>(null);

  useEffect(() => {
    let cancelled = false;
    onStatusChange('loading');
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));
    loader.load(
      vrmUrl,
      (gltf) => {
        if (cancelled) return;
        const loaded = gltf.userData.vrm as VRM | undefined;
        if (!loaded) {
          onStatusChange('error');
          return;
        }
        VRMUtils.removeUnnecessaryVertices(loaded.scene);
        VRMUtils.combineSkeletons(loaded.scene);
        loaded.scene.traverse((obj) => {
          if ('frustumCulled' in obj) {
            (obj as THREE.Mesh).frustumCulled = false;
          }
        });
        setVrm(loaded);
        onStatusChange('ready');
      },
      undefined,
      (err) => {
        console.error('VRM load error', err);
        if (!cancelled) onStatusChange('error');
      },
    );
    return () => {
      cancelled = true;
    };
  }, [vrmUrl, onStatusChange]);

  return (
    <>
      <ambientLight intensity={0.8} />
      <directionalLight position={[1, 2, 3]} intensity={1.1} />
      <directionalLight position={[-1, 1, -2]} intensity={0.4} />
      {vrm ? (
        <AvatarMesh
          vrm={vrm}
          audioElement={audioElement}
          expression={expression}
          isSleeping={isSleeping}
        />
      ) : null}
    </>
  );
}

export default function VRMScene(props: VRMAvatarProps) {
  const [status, setStatus] = useState<Status>('loading');
  const cameraPosition = useMemo(() => [0, 1.35, 1.2] as const, []);

  return (
    <div
      className={`relative h-full w-full overflow-hidden rounded-lg ${props.className ?? ''}`}
    >
      <div
        aria-hidden
        className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,hsl(280_80%_20%/0.6),hsl(240_10%_4%)_70%)]"
      />
      <Canvas
        camera={{ position: [...cameraPosition], fov: 24, near: 0.1, far: 20 }}
        gl={{ alpha: true, antialias: true }}
        style={{ position: 'absolute', inset: 0 }}
      >
        <Scene {...props} onStatusChange={setStatus} />
      </Canvas>

      {status === 'loading' ? (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
          Loading avatar…
        </div>
      ) : null}
      {status === 'error' ? (
        <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-destructive-foreground">
          <div>
            <p className="font-medium">Couldn&apos;t load the VRM.</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Check the avatar URL or drop a file at{' '}
              <code className="font-mono">/public/demo.vrm</code>.
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
