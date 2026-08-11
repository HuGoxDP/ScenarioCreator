// scripts/helpers/PlanetFactory.ts

import {
    GameObject, MeshFilter, MeshRenderer, Mesh,
    StandardMaterial, Color, Texture2D, Vector3
} from "WebEngineTS";

// ==================== INTERFACES ====================

export interface PlanetTextures {
    albedo?: Texture2D;
    normal?: Texture2D;
    metallic?: Texture2D;
    emissive?: Texture2D;
}

export interface TexturedPlanetOptions {
    name: string;
    radius: number;
    color: Color;
    metallic?: number;
    smoothness?: number;
    emissiveColor?: Color;
    emissiveIntensity?: number;
    segments?: number;
    textures?: PlanetTextures;
}

// ==================== MODEL NORMALIZATION ====================

/**
 * Scales a loaded GLB model so its visual radius matches targetRadius.
 * @param model — root GameObject of the loaded model.
 * @param targetRadius — desired radius in world units.
 */
export function normalizeModelToRadius(model: GameObject, targetRadius: number): void {
    model.normalizeToSize(targetRadius * 2); // diameter = radius × 2
}

// ==================== FACTORY FUNCTIONS ====================

export function createTexturedPlanet(opts: TexturedPlanetOptions): GameObject {
    const go = new GameObject(opts.name);
    const segments = opts.textures ? (opts.segments ?? 64) : (opts.segments ?? 32);

    go.addComponent(MeshFilter).sharedMesh = Mesh.createSphere(opts.radius, segments);

    const mat = new StandardMaterial();
    mat.name = `${opts.name} Material`;
    mat.albedoColor = opts.color;
    mat.metallic = opts.metallic ?? 0;
    mat.smoothness = opts.smoothness ?? 0.5;

    const tex = opts.textures;
    if (tex) {
        if (tex.albedo) { mat.albedoTexture = tex.albedo; mat.albedoColor = Color.white; }
        if (tex.normal)   mat.normalTexture = tex.normal;
        if (tex.metallic) mat.metallicTexture = tex.metallic;
        if (tex.emissive) {
            mat.emissionTexture = tex.emissive;
            mat.emissionColor = opts.emissiveColor ?? Color.white;
        }
    }

    if (!tex?.emissive && opts.emissiveColor) {
        const intensity = opts.emissiveIntensity ?? 1;
        mat.emissionColor = new Color(
            opts.emissiveColor.r * intensity,
            opts.emissiveColor.g * intensity,
            opts.emissiveColor.b * intensity, 1
        );
    }

    go.addComponent(MeshRenderer).sharedMaterial = mat;
    return go;
}

export function createOrbitRing(name: string, radius: number): GameObject {
    const go = new GameObject(name);
    go.addComponent(MeshFilter).sharedMesh = Mesh.createTorus(radius, 0.015, 128, 4);
    const mat = new StandardMaterial();
    mat.albedoColor = new Color(0.25, 0.25, 0.35, 1);
    mat.smoothness = 0.1;
    mat.metallic = 0;
    go.addComponent(MeshRenderer).sharedMaterial = mat;
    return go;
}