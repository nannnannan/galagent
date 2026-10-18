import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const exportDir = path.join(rootDir, "art", "live2d", "export");
const expDir = path.join(exportDir, "expressions");
fs.mkdirSync(expDir, { recursive: true });

const expressions = {
  neutral: [
    { Id: "ParamBrowLY", Value: 0.0, Blend: "Add" },
    { Id: "ParamBrowRY", Value: 0.0, Blend: "Add" },
    { Id: "ParamEyeLSmile", Value: 0.0, Blend: "Overwrite" },
    { Id: "ParamEyeRSmile", Value: 0.0, Blend: "Overwrite" },
    { Id: "ParamMouthForm", Value: 0.0, Blend: "Add" },
    { Id: "ParamMouthOpenY", Value: 0.0, Blend: "Add" },
    { Id: "ParamCheek", Value: 0.0, Blend: "Overwrite" }
  ],
  curious: [
    { Id: "ParamAngleZ", Value: -10.0, Blend: "Add" },
    { Id: "ParamBrowLY", Value: 0.65, Blend: "Add" },
    { Id: "ParamBrowRY", Value: 0.65, Blend: "Add" },
    { Id: "ParamEyeBallY", Value: 0.25, Blend: "Add" },
    { Id: "ParamMouthForm", Value: 0.15, Blend: "Add" },
    { Id: "ParamMouthOpenY", Value: 0.45, Blend: "Overwrite" },
    { Id: "ParamCheek", Value: 0.15, Blend: "Overwrite" }
  ],
  pleased: [
    { Id: "ParamAngleZ", Value: 5.0, Blend: "Add" },
    { Id: "ParamBrowLY", Value: 0.35, Blend: "Add" },
    { Id: "ParamBrowRY", Value: 0.35, Blend: "Add" },
    { Id: "ParamEyeLOpen", Value: 0.0, Blend: "Overwrite" },
    { Id: "ParamEyeROpen", Value: 0.0, Blend: "Overwrite" },
    { Id: "ParamEyeLSmile", Value: 1.0, Blend: "Overwrite" },
    { Id: "ParamEyeRSmile", Value: 1.0, Blend: "Overwrite" },
    { Id: "ParamMouthForm", Value: 0.95, Blend: "Add" },
    { Id: "ParamMouthOpenY", Value: 0.0, Blend: "Overwrite" },
    { Id: "ParamCheek", Value: 0.65, Blend: "Overwrite" }
  ],
  flustered: [
    { Id: "ParamAngleY", Value: -8.0, Blend: "Add" },
    { Id: "ParamAngleZ", Value: -6.0, Blend: "Add" },
    { Id: "ParamBrowLY", Value: 0.25, Blend: "Add" },
    { Id: "ParamBrowRY", Value: 0.25, Blend: "Add" },
    { Id: "ParamBrowLAngle", Value: 0.65, Blend: "Add" },
    { Id: "ParamBrowRAngle", Value: 0.65, Blend: "Add" },
    { Id: "ParamEyeBallX", Value: -0.4, Blend: "Add" },
    { Id: "ParamEyeBallY", Value: -0.25, Blend: "Add" },
    { Id: "ParamMouthForm", Value: -0.65, Blend: "Add" },
    { Id: "ParamMouthOpenY", Value: 0.42, Blend: "Overwrite" },
    { Id: "ParamCheek", Value: 1.0, Blend: "Overwrite" }
  ],
  annoyed: [
    { Id: "ParamAngleX", Value: -6.0, Blend: "Add" },
    { Id: "ParamAngleY", Value: -5.0, Blend: "Add" },
    { Id: "ParamBrowLY", Value: -0.55, Blend: "Add" },
    { Id: "ParamBrowRY", Value: -0.55, Blend: "Add" },
    { Id: "ParamBrowLAngle", Value: -0.8, Blend: "Add" },
    { Id: "ParamBrowRAngle", Value: -0.8, Blend: "Add" },
    { Id: "ParamEyeLOpen", Value: 0.82, Blend: "Multiply" },
    { Id: "ParamEyeROpen", Value: 0.82, Blend: "Multiply" },
    { Id: "ParamMouthForm", Value: -0.9, Blend: "Add" },
    { Id: "ParamMouthOpenY", Value: 0.0, Blend: "Overwrite" },
    { Id: "ParamCheek", Value: 0.35, Blend: "Overwrite" }
  ],
  softened: [
    { Id: "ParamAngleZ", Value: 6.0, Blend: "Add" },
    { Id: "ParamBrowLY", Value: 0.2, Blend: "Add" },
    { Id: "ParamBrowRY", Value: 0.2, Blend: "Add" },
    { Id: "ParamBrowLAngle", Value: 0.35, Blend: "Add" },
    { Id: "ParamBrowRAngle", Value: 0.35, Blend: "Add" },
    { Id: "ParamEyeLOpen", Value: 0.88, Blend: "Multiply" },
    { Id: "ParamEyeROpen", Value: 0.88, Blend: "Multiply" },
    { Id: "ParamMouthForm", Value: 0.7, Blend: "Add" },
    { Id: "ParamMouthOpenY", Value: 0.0, Blend: "Overwrite" },
    { Id: "ParamCheek", Value: 0.6, Blend: "Overwrite" }
  ]
};

for (const [name, params] of Object.entries(expressions)) {
  const expJson = {
    Type: "Live2D Expression",
    FadeInTime: 0.25,
    FadeOutTime: 0.25,
    Parameters: params
  };
  fs.writeFileSync(path.join(expDir, `${name}.exp3.json`), JSON.stringify(expJson, null, 2) + "\n");
}

const model3Path = path.join(exportDir, "kimi.model3.json");
const model3 = JSON.parse(fs.readFileSync(model3Path, "utf8"));
model3.FileReferences.Expressions = Object.keys(expressions).map((name) => ({
  Name: name,
  File: `expressions/${name}.exp3.json`
}));
model3.Groups = [
  {
    Target: "Parameter",
    Name: "EyeBlink",
    Ids: ["ParamEyeLOpen", "ParamEyeROpen"]
  },
  {
    Target: "Parameter",
    Name: "LipSync",
    Ids: ["ParamMouthOpenY"]
  }
];
fs.writeFileSync(model3Path, JSON.stringify(model3, null, 2) + "\n");

const cmo3Src = path.join(rootDir, "art", "live2d", "kimi.cmo3");
const cmo3Dst = path.join(rootDir, "art", "live2d", "kimi-layered-source-v02.cmo3");
if (fs.existsSync(cmo3Src)) {
  fs.copyFileSync(cmo3Src, cmo3Dst);
}

const targetDir = path.join(rootDir, "prototypes", "live2d", "assets", "kimi");
fs.rmSync(targetDir, { recursive: true, force: true });
fs.cpSync(exportDir, targetDir, { recursive: true });
console.log("Synced exportDir to prototypes/live2d/assets/kimi and updated kimi-layered-source-v02.cmo3");
