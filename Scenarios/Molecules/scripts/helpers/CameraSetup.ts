// scripts/helpers/CameraSetup.ts
// ============================================================
// Camera rig: Camera + Brain + 3 Virtual Cameras.
// Scenario calls createCameraRig() and gets back a simple
// interface to switch modes — no Cinemachine details leak out.
// ============================================================

import {
    GameObject, Camera, Vector3, Color, Transform,
    CameraClearFlags,

    // Cinemachine
    CinemachineBrain, CinemachineVirtualCamera, CinemachineBlendStyle,
    CinemachineOrbitalBody, CinemachineOrbitalAim,
    CinemachineFlyBody, CinemachinePOVAim,
    CinemachineFollowBody, CinemachineHardLookAtAim,
} from "WebEngineTS";

// ==================== PUBLIC INTERFACE ====================

/**
 * Simple facade for camera control. Scenario uses this
 * to switch camera modes without touching Cinemachine directly.
 */
export interface ICameraRig {
    /** Switch to orbit camera (mouse drag to rotate, scroll to zoom). */
    activateOrbit(): void;

    /** Switch to fly/FPS camera (WASD + mouse look). */
    activateFly(): void;

    /** Switch to follow camera tracking a target transform. */
    activateFollow(target: Transform): void;

    /**
     * Re-frames the orbit camera. Subjects vary hugely in size — a scenario
     * showing both H₂ and a salt lattice needs to pull back for one and move in
     * for the other, or half of them render as a dot.
     */
    setOrbitDistance(distance: number): void;

    /** The main Camera component (for reading FOV, aspect, etc.). */
    readonly camera: Camera;
}

/**
 * Configuration for camera rig creation.
 */
export interface CameraConfig {
    /** FOV for main camera. Default 60. */
    fieldOfView?: number;
    /** Near clip plane. Default 0.1. */
    nearClip?: number;
    /** Far clip plane. Default 500. */
    farClip?: number;
    /** Use skybox as background. Default true. */
    useSkybox?: boolean;
    /** Fallback background color when no skybox loaded. */
    backgroundColor?: Color;
    /** Orbit camera initial distance. Default 38. */
    orbitDistance?: number;
    /** Orbit camera max distance. Default 120. */
    orbitMaxDistance?: number;
    /** Fly camera starting position. Default (0, 10, 40). */
    flyStartPosition?: Vector3;
}

// ==================== FACTORY FUNCTION ====================

export function createCameraRig(config: CameraConfig = {}): ICameraRig {
    const fov        = config.fieldOfView ?? 60;
    const nearClip   = config.nearClip ?? 0.1;
    const farClip    = config.farClip ?? 500;
    const useSkybox  = config.useSkybox ?? true;
    const bgColor    = config.backgroundColor ?? new Color(0.01, 0.01, 0.03, 1);
    const orbitDist  = config.orbitDistance ?? 38;
    const orbitMax   = config.orbitMaxDistance ?? 120;
    const flyPos     = config.flyStartPosition ?? new Vector3(0, 10, 40);

    // ── Main Camera + Brain ──

    const camGo = new GameObject("Main Camera");
    camGo.tag = "MainCamera";

    const cam = camGo.addComponent(Camera);
    cam.fieldOfView = fov;
    cam.nearClipPlane = nearClip;
    cam.farClipPlane = farClip;
    cam.clearFlags = useSkybox ? CameraClearFlags.Skybox : CameraClearFlags.SolidColor;
    cam.backgroundColor = bgColor;

    const brain = camGo.addComponent(CinemachineBrain);
    brain.defaultBlendStyle = CinemachineBlendStyle.Cut;
    brain.defaultBlendTime = 0;

    // ── VCam 1: Orbit ──

    const orbitGo = new GameObject("VCam Orbit");
    const orbitVCam = orbitGo.addComponent(CinemachineVirtualCamera);
    orbitVCam.priority = 10;   // active by default
    orbitVCam.fieldOfView = fov;

    const orbBody = orbitGo.addComponent(CinemachineOrbitalBody);
    orbBody.orbitCenter = Vector3.zero;
    orbBody.distance = orbitDist;
    orbBody.minDistance = 3;
    orbBody.maxDistance = orbitMax;
    orbBody.orbitSpeed = 0.3;
    orbBody.zoomSpeed = 2;
    orbBody.panSpeed = 0.01;
    orbBody.damping = 6;

    orbitGo.addComponent(CinemachineOrbitalAim);

    // ── VCam 2: Fly (FPS) ──

    const flyGo = new GameObject("VCam Fly");
    flyGo.transform.position = flyPos;
    const flyVCam = flyGo.addComponent(CinemachineVirtualCamera);
    flyVCam.priority = 0;
    flyVCam.fieldOfView = 75;

    const flyBody = flyGo.addComponent(CinemachineFlyBody);
    flyBody.moveSpeed = 15;
    flyBody.fastMultiplier = 3;

    const flyAim = flyGo.addComponent(CinemachinePOVAim);
    flyAim.sensitivity = 0.15;

    // ── VCam 3: Follow ──

    const followGo = new GameObject("VCam Follow");
    const followVCam = followGo.addComponent(CinemachineVirtualCamera);
    followVCam.priority = 0;
    followVCam.fieldOfView = fov;

    const followBody = followGo.addComponent(CinemachineFollowBody);
    followBody.offset = new Vector3(0, 2, -5);
    followBody.damping = 4;

    followGo.addComponent(CinemachineHardLookAtAim);

    // ── Build facade ──

    const rig: ICameraRig = {
        camera: cam,

        activateOrbit() {
            orbitVCam.priority = 10;
            flyVCam.priority = 0;
            followVCam.priority = 0;
            console.log("[Camera] → Orbit");
        },

        activateFly() {
            flyVCam.priority = 10;
            orbitVCam.priority = 0;
            followVCam.priority = 0;
            console.log("[Camera] → Fly (click to lock cursor)");
        },

        activateFollow(target: Transform) {
            followVCam.follow = target;
            followVCam.lookAt = target;
            followVCam.priority = 10;
            orbitVCam.priority = 0;
            flyVCam.priority = 0;
            console.log("[Camera] → Follow");
        },

        setOrbitDistance(distance: number) {
            // Clamp into the rig's own zoom range so a caller cannot place the
            // camera somewhere the user could never scroll back from.
            orbBody.distance = Math.min(Math.max(distance, orbBody.minDistance), orbBody.maxDistance);
        },
    };

    return rig;
}