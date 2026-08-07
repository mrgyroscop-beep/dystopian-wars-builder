import type { RuleTranslation } from "../application/glossary/glossary-contract";
import type { RuleReadModel, WeaponProfileReadModel } from "../application/rosters/profile-rules";
import type { ShipEditorReadyReadModel } from "../application/rosters/ship-editor";
import type { SafePresentation } from "../domain/catalog";

export type CampaignFaction = "Crown" | "Empire";
export type CampaignTab = "mission" | "crown" | "empire";
export type CampaignMarkerKind = "mine" | "platform" | "refinery" | "wreck";

export interface CampaignMarker {
  readonly kind: CampaignMarkerKind;
  readonly x: number;
  readonly y: number;
}

export interface CampaignFleetUnit {
  readonly profileId: string;
  readonly models: number;
  readonly escorts?: number;
}

export interface CampaignScenario {
  readonly act: number;
  readonly battlefield: "24″ × 24″" | "36″ × 36″";
  readonly crown: readonly CampaignFleetUnit[];
  readonly empire: readonly CampaignFleetUnit[];
  readonly id: string;
  readonly initiative: string;
  readonly markers: readonly CampaignMarker[];
  readonly narrative: string;
  readonly objective: string;
  readonly principles: readonly string[];
  readonly rounds: number;
  readonly setup: readonly string[];
  readonly specialObjective: string;
  readonly specialRules: readonly { readonly title: string; readonly text: string }[];
  readonly title: string;
  readonly titleRu: string;
}

export interface CampaignProfile {
  readonly faction: CampaignFaction;
  readonly id: string;
  readonly modelCount: number;
  readonly name: string;
  readonly properties: readonly string[];
  readonly role: string;
  readonly stats: Readonly<Record<StatName, string>>;
  readonly systems: readonly string[];
  readonly tags: readonly string[];
  readonly weapons: readonly CampaignWeapon[];
}

export interface CampaignWeapon {
  readonly arc: string;
  readonly close: string;
  readonly extreme: string;
  readonly name: string;
  readonly qualities?: string;
  readonly standard: string;
}

type StatName = "MAS" | "SPD" | "TRN" | "DEF" | "ARM" | "HUL" | "ACT" | "BRD" | "REP" | "CRW";

const stats = (
  MAS: string,
  SPD: string,
  TRN: string,
  DEF: string,
  ARM: string,
  HUL: string,
  ACT: string,
  BRD: string,
  REP: string,
  CRW: string,
): CampaignProfile["stats"] => ({ MAS, SPD, TRN, DEF, ARM, HUL, ACT, BRD, REP, CRW });

const campaignRuleTranslations: Readonly<Record<string, RuleTranslation>> = {
  Hunter: {
    id: "R9001",
    language: "ru",
    sourceTitle: "Hunter",
    title: "Охотник",
    text: "Когда этот отряд выполняет атаку, активный адмирал может перебросить любые пустые результаты броска действия, если каждая участвующая модель обладает этим свойством, а первоначальная цель имеет указанный в скобках трейт.",
  },
  "Guardian Generator": {
    id: "R9002",
    language: "ru",
    sourceTitle: "Guardian Generator",
    title: "Генератор-хранитель",
    text: "Этот отряд может пользоваться запасом Хранителя. Количество доступных кубиков и правила их применения указаны в описании соответствующего акта кампании.",
  },
  Gaseous: {
    id: "R9003",
    language: "ru",
    sourceTitle: "Gaseous",
    title: "Газовое",
    text: "Если всё оружие, участвующее в атаке, обладает этим качеством, атака считается газовой. Каждый успех наносит один уровень беспорядка вместо одного повреждения. После трёх уровней каждый лишний уровень превращается в одно повреждение. Газовая атака не вызывает эффект «Под огнём». Модель, получившая повреждение от газовой атаки, получает критический эффект Hazard, если его ещё нет.",
  },
  "Autonomous Mine": {
    id: "R9004",
    language: "ru",
    sourceTitle: "Autonomous Mine",
    title: "Автономная мина",
    text: "Мина срабатывает при контакте с надводной или воздушной моделью. Все модели в радиусе 2″ с тем же позиционным трейтом получают один уровень беспорядка. Ближайшая модель подвергается взрыву Bangpae: бросьте X кубиков действия; обычный удар наносит одно повреждение, тяжёлый или взрывной — два. После срабатывания мина уничтожается.",
  },
};

const ruleDefinitions: readonly Omit<RuleReadModel, "available" | "diagnostic">[] = [
  {
    id: "R9001",
    label: "Hunter",
    description: textPresentation(
      "When this unit makes an Attack action, the active Admiral can re-roll any Blanks in the Action Roll, so long as each Participating model has this Property and the Initial Target has the Trait shown in brackets.",
    ),
    translation: campaignRuleTranslations.Hunter!,
  },
  {
    id: "R9002",
    label: "Guardian Generator",
    description: textPresentation(
      "This unit can benefit from the Guardian Pool used in this campaign.",
    ),
    translation: campaignRuleTranslations["Guardian Generator"]!,
  },
  {
    id: "R70",
    label: "Shallow Draught",
    description: textPresentation(
      "This model’s movement is not Impeded by Treacherous Water, and it can Rally even if it is in Proximity of a Terrain Feature.",
    ),
  },
  {
    id: "R85",
    label: "Elevated",
    description: textPresentation(
      "This model is not Impeded by Treacherous Water, does not Trigger Minefield markers, and never suffers Critical Damage as a result of contacting a Wreck marker. If this model is the Initial Target of an Attack action, Submerged Weapons cannot Contribute.",
    ),
  },
  {
    id: "R181",
    label: "Boarding Parties",
    description: textPresentation(
      "This model’s unit can make Boarding actions. If this model Participates, it contributes X dice to the Action Roll. If it is the Target, its Admiral adds X dice to the Resistance Roll.",
    ),
  },
  {
    id: "R139",
    label: "Heavy Shield Generator",
    description: textPresentation(
      "Each model in this unit gains a +1 Modifier to its Armour rating when it is the Initial Target of an Attack action. This has no effect against Assault or Submerged Weapons.",
    ),
  },
  {
    id: "R132",
    label: "Stoic",
    description: textPresentation(
      "Whenever this model would raise its Disorder level from 0 to 1, it gains a Stoic token instead. A model with that token does not suffer the effects of Disorder until it gains another level.",
    ),
  },
  {
    id: "R84",
    label: "Shroud Generator",
    description: textPresentation(
      "When a model in this unit is the Initial Target of an Attack action, each Participating model’s Visibility counts as Hampered unless it is within 5″ and has the same Positional Trait.",
    ),
  },
  {
    id: "R170",
    label: "Pivot",
    description: textPresentation(
      "This model can Pivot when it Comes About during its Movement Step.",
    ),
  },
  {
    id: "R286",
    label: "Evasive",
    description: textPresentation(
      "During the Inflict Damage step, this model’s Admiral may convert Damage into Disorder until the model has 3 levels of Disorder. If Evasive Manoeuvres are declared, the model does not suffer Under Fire.",
    ),
  },
  {
    id: "R248",
    label: "Platform",
    description: textPresentation(
      "Once Deployed, this model cannot move or be moved and cannot Withdraw. Vulnerable Stern does not apply. If it is Destroyed or Abandoned, replace it with a Wreck marker where possible.",
    ),
  },
  {
    id: "R9003",
    label: "Gaseous",
    description: textPresentation(
      "If all Contributing weapons have this Quality, each Success inflicts 1 Disorder instead of 1 Damage. Excess Disorder becomes Damage. A Gaseous attack does not trigger Under Fire, and Damage caused by it applies a Hazard Critical Damage token if the Target does not already have one.",
    ),
    translation: campaignRuleTranslations.Gaseous!,
  },
  {
    id: "R9004",
    label: "Autonomous Mine",
    description: textPresentation(
      "This model is an Autonomous Mine. It is Triggered by contact with a Surface or Airborne model, inflicts Disorder nearby, resolves a Bangpae Detonation against the closest model, and is then Destroyed.",
    ),
    translation: campaignRuleTranslations["Autonomous Mine"]!,
  },
  {
    id: "R95",
    label: "Aerial",
    description: textPresentation(
      "Aerial Weapons can only Contribute if all Contributing weapons are Aerial. The Initial Target cannot be Underwater.",
    ),
  },
  {
    id: "R112",
    label: "Assault",
    description: textPresentation(
      "Assault Weapons can only Contribute if all Contributing weapons are Assault. A model can Participate only when the Initial Target is within 2″.",
    ),
  },
  {
    id: "R205",
    label: "Bomb",
    description: textPresentation(
      "Bomb Weapons can only Contribute if all Contributing weapons are Bomb. The Initial Target cannot be Airborne and this attack never benefits from Vulnerable Stern.",
    ),
  },
  {
    id: "R189",
    label: "Submerged",
    description: textPresentation(
      "Submerged Weapons can only Contribute if all Contributing weapons are Submerged. They can target Underwater models but cannot target Airborne models.",
    ),
  },
  {
    id: "R152",
    label: "Torrent",
    description: textPresentation(
      "Torrent Weapons resolve a sequence of repeated attacks up to X times. All Contributing weapons must be Torrent Weapons, and the Initial Target cannot be Underwater.",
    ),
  },
  {
    id: "R253",
    label: "Hazard",
    description: textPresentation(
      "If the Initial Target suffers at least 1 Damage, roll X Critical Damage Dice for each Contributing weapon with this Quality. A Hazard result applies that Critical Damage Effect.",
    ),
  },
  {
    id: "R211",
    label: "Navigation Lock",
    description: textPresentation(
      "If the Initial Target suffers at least 1 Damage, roll X Critical Damage Dice for each Contributing weapon with this Quality. A Navigation Lock result applies that Critical Damage Effect.",
    ),
  },
  {
    id: "R135",
    label: "Shredded Defences",
    description: textPresentation(
      "If the Initial Target suffers at least 1 Damage, roll X Critical Damage Dice for each Contributing weapon with this Quality. A Shredded Defences result applies that Critical Damage Effect.",
    ),
  },
] as const;

export const campaignRules: readonly RuleReadModel[] = ruleDefinitions.map((rule) => ({
  ...rule,
  available: true,
  diagnostic: null,
}));

const profiles: readonly CampaignProfile[] = [
  {
    id: "strikakulam",
    name: "HMIS Strikakulam",
    role: "Sabre Command Cruiser",
    faction: "Crown",
    modelCount: 1,
    tags: ["Crown", "British", "Surface", "Flagship", "Ship"],
    stats: stats("3", "2″–8″", "3", "5", "4", "9", "3", "2", "3", "8"),
    properties: ["Hunter (Flagship)"],
    systems: ["Guardian Generator"],
    weapons: [
      weapon("Torpedo Salvo", "F", "7", "7", "7", "Submerged"),
      weapon("Heavy Gun Battery", "FPS", "4", "7", "—"),
      weapon("Heavy Gun Battery", "PSA", "4", "7", "—"),
      weapon("Light Gun Battery", "FPS", "2", "5", "—"),
    ],
  },
  {
    id: "pembroke",
    name: "HMS Pembroke",
    role: "Albion Cruiser",
    faction: "Crown",
    modelCount: 1,
    tags: ["Crown", "British", "Surface", "Line", "Ship"],
    stats: stats("3", "2″–8″", "3", "5", "4", "9", "2", "2", "3", "7"),
    properties: [],
    systems: ["Guardian Generator"],
    weapons: [
      weapon("Torpedo Salvo", "F", "7", "7", "7", "Submerged"),
      weapon("Heavy Gun Battery", "FPS", "4", "7", "—"),
      weapon("Heavy Gun Battery", "PSA", "4", "7", "—"),
    ],
  },
  {
    id: "crows",
    name: "The Crows",
    role: "Caliburn Frigates",
    faction: "Crown",
    modelCount: 2,
    tags: ["Crown", "British", "Surface", "Patrol", "Ship", "Light Vessel"],
    stats: stats("1", "1″–7″", "4", "4", "3", "4", "1", "1", "2", "5"),
    properties: ["Shallow Draught"],
    systems: [],
    weapons: [
      weapon("Torpedo Salvo", "F", "4", "4", "4", "Submerged"),
      weapon("Light Gun Battery", "FPS", "2", "4", "—"),
    ],
  },
  {
    id: "kamarupa",
    name: "Kamarupa Squadron",
    role: "Excalibur Heavy Destroyers",
    faction: "Crown",
    modelCount: 2,
    tags: ["Crown", "British", "Surface", "Patrol", "Ship"],
    stats: stats("2", "1″–8″", "3", "5", "3", "6", "2", "1", "2", "5"),
    properties: [],
    systems: [],
    weapons: [
      weapon("Torpedo Salvo", "F", "4", "4", "4", "Submerged"),
      weapon("Light Gun Battery", "FPS", "2", "4", "—"),
      weapon("Light Gun Battery", "PSA", "2", "4", "—"),
    ],
  },
  {
    id: "skua",
    name: "Skua Squadron",
    role: "Inuit Strike Rotors",
    faction: "Crown",
    modelCount: 2,
    tags: ["Crown", "British", "Airborne", "Patrol", "Airship", "Light Vessel"],
    stats: stats("1", "2″–6″", "4", "5", "3", "3", "2", "—", "2", "6"),
    properties: [],
    systems: ["Guardian Generator"],
    weapons: [
      weapon("Torpedo Salvo", "F", "4", "4", "4", "Submerged"),
      weapon("Unaaq Heavy Torpedoes", "F", "6", "6", "6", "Submerged, Navigation Lock (1)"),
    ],
  },
  {
    id: "tulwar",
    name: "Patrol Group Tulwar",
    role: "Gharial Strike Hovercraft",
    faction: "Crown",
    modelCount: 2,
    tags: ["Crown", "Indian Raj", "Surface", "Patrol", "Hovercraft"],
    stats: stats("2", "1″–7″", "4", "2", "3", "8", "2", "—", "2", "6"),
    properties: ["Elevated", "Boarding Parties (6)"],
    systems: ["Guardian Generator"],
    weapons: [
      weapon("Light Gun Battery", "FP", "2", "3", "—"),
      weapon("Light Gun Battery", "FS", "2", "3", "—"),
      weapon("Light Gun Battery", "FPS", "2", "3", "—"),
    ],
  },
  {
    id: "chaudharys-revenge",
    name: "Chaudhary’s Revenge",
    role: "Vivienne Flak Submarines",
    faction: "Crown",
    modelCount: 2,
    tags: ["Crown", "British", "Underwater", "Support", "Submarine"],
    stats: stats("3", "2″–8″", "3", "3", "3", "9", "3", "—", "4", "8"),
    properties: ["Hunter (Airborne)"],
    systems: ["Guardian Generator"],
    weapons: [
      weapon("Torpedo Salvo", "F", "7", "7", "7", "Submerged"),
      weapon("Fragmentation Ripple Cannonade", "F", "5", "5", "—", "Aerial, Shredded Defences (2)"),
      weapon("Light Gun Battery", "F", "2", "5", "—"),
    ],
  },
  {
    id: "sentosa",
    name: "The Sentosa",
    role: "Titan Mass Conveyor",
    faction: "Crown",
    modelCount: 1,
    tags: ["Crown", "Surface", "Logistical", "Ship", "Merchantman"],
    stats: stats("3", "2″–7″", "2", "2", "3", "7", "1", "—", "3", "6"),
    properties: [],
    systems: ["Heavy Shield Generator"],
    weapons: [weapon("Light Gun Battery", "FPS", "2", "5", "—")],
  },
  {
    id: "nagato",
    name: "The Nagato",
    role: "Oni Command Cruiser",
    faction: "Empire",
    modelCount: 1,
    tags: ["Empire", "Japanese", "Surface", "Flagship", "Ship"],
    stats: stats("4", "2″–8″", "3", "8", "5", "10", "3", "2", "3", "10"),
    properties: ["Stoic"],
    systems: ["Shroud Generator"],
    weapons: [
      weapon("Heavy Torpedo Salvo", "F", "7", "7", "7", "Submerged"),
      weapon("Heavy Gun Battery", "FPS", "4", "6", "—"),
      weapon("Heavy Gun Battery", "FPS", "4", "6", "—"),
    ],
  },
  {
    id: "buredo",
    name: "The Burēdo",
    role: "Ōsaka Cruiser",
    faction: "Empire",
    modelCount: 1,
    tags: ["Empire", "Japanese", "Surface", "Line", "Ship"],
    stats: stats("3", "2″–8″", "3", "6", "4", "8", "2", "2", "3", "9"),
    properties: [],
    systems: [],
    weapons: [
      weapon("Torpedo Salvo", "F", "5", "5", "5", "Submerged"),
      weapon("Heavy Gun Battery", "FPS", "4", "6", "—"),
      weapon("Heavy Gun Battery", "FPS", "4", "6", "—"),
    ],
  },
  {
    id: "taiyo-furea",
    name: "Taiyō Furea",
    role: "Sakata Heavy Destroyers",
    faction: "Empire",
    modelCount: 2,
    tags: ["Empire", "Japanese", "Surface", "Line", "Ship"],
    stats: stats("2", "1″–8″", "3", "5", "4", "5", "2", "1", "2", "8"),
    properties: [],
    systems: [],
    weapons: [
      weapon("Light Torpedo Salvo", "F", "3", "3", "3", "Submerged"),
      weapon("Light Gun Battery", "FPS", "2", "3", "—"),
      weapon("Light Gun Battery", "PSA", "2", "3", "—"),
    ],
  },
  {
    id: "diyu-huo",
    name: "Dìyù Huǒ",
    role: "Shénlóng Draconic Colossus",
    faction: "Empire",
    modelCount: 1,
    tags: ["Empire", "Chinese", "Airborne", "Patrol", "Colossus"],
    stats: stats("3", "0″–8″", "2", "5", "4", "8", "3", "—", "3", "9"),
    properties: ["Pivot"],
    systems: [],
    weapons: [
      weapon("Heavy Gun Battery", "FPSA", "4", "6", "—"),
      weapon("Dragon’s Breath", "FPS", "6", "2", "—", "Torrent (2), Hazard (2)"),
      weapon("Scything Tail", "FPSA", "5", "—", "—", "Assault"),
      weapon("Talon Beam Cannons", "FPS", "6", "6", "6"),
      weapon("Ripping Talons", "FPS", "5", "—", "—", "Assault"),
    ],
  },
  {
    id: "shinsei",
    name: "The Shinsei",
    role: "Kiyohime Draconic Colossus",
    faction: "Empire",
    modelCount: 1,
    tags: ["Empire", "Japanese", "Airborne", "Patrol", "Colossus"],
    stats: stats("3", "0″–8″", "2", "5", "4", "8", "3", "—", "3", "10"),
    properties: ["Boarding Parties (10)", "Pivot"],
    systems: [],
    weapons: [
      weapon("Kodoku no Ibuki", "FPS", "6", "2", "—", "Torrent (2), Gaseous"),
      weapon("Rending Talons", "FPS", "8", "—", "—", "Assault, Shredded Defences (2)"),
      weapon("Scything Tail", "FPSA", "5", "—", "—", "Assault"),
    ],
  },
  {
    id: "ssang",
    name: "Ssang",
    role: "Sanshin Judgement Cruisers",
    faction: "Empire",
    modelCount: 2,
    tags: ["Empire", "Korean", "Airborne", "Support", "Rotorcraft"],
    stats: stats("3", "4″–12″", "4", "6", "3", "7", "3", "—", "2", "9"),
    properties: ["Evasive"],
    systems: [],
    weapons: [
      weapon("Korean Heavy Torpedo Salvo", "F", "6", "6", "6", "Submerged"),
      weapon("Alchemical Bomb", "A", "6", "—", "—", "Bomb, Hazard (3)"),
      weapon("Light Alchemical Rockets", "FP", "—", "4", "—", "Aerial, Hazard (1)"),
      weapon("Light Alchemical Rockets", "FS", "—", "4", "—", "Hazard (1)"),
    ],
  },
  {
    id: "bunya",
    name: "Bun’ya Automata",
    role: "Bangpae Explosive Automata",
    faction: "Empire",
    modelCount: 2,
    tags: ["Empire", "Korean", "Airborne", "Support", "Automata"],
    stats: stats("1", "1″–4″", "2", "2", "2", "2", "1", "—", "—", "12"),
    properties: ["Autonomous Mine (3)", "Pivot"],
    systems: [],
    weapons: [],
  },
  {
    id: "ashmore-refinery",
    name: "Ashmore Refinery",
    role: "Offshore Heavy Platform",
    faction: "Empire",
    modelCount: 1,
    tags: ["Empire", "Surface", "Support", "Platform", "Immobile", "Repair"],
    stats: stats("5", "—", "—", "5", "4", "10", "3", "—", "4", "8"),
    properties: ["Platform"],
    systems: [],
    weapons: [
      weapon("Heavy Gun Battery", "FPSA", "6", "8", "—"),
      weapon("Heavy Gun Battery", "FPSA", "6", "8", "—"),
    ],
  },
] as const;

export const campaignScenarios: readonly CampaignScenario[] = [
  {
    id: "act-1",
    act: 1,
    title: "A Quiet Prelude",
    titleRu: "Тихая прелюдия",
    battlefield: "24″ × 24″",
    rounds: 3,
    initiative: "В первом раунде инициатива у Короны",
    narrative:
      "У рифа Эшмор патрульный крейсер Короны обнаруживает обломки двух судов. На горизонте появляется крейсер Империи — столкновение становится неизбежным.",
    principles: ["Перемещение моделей", "Активация отряда", "Атакующие действия"],
    setup: [
      "Разметьте игровое поле 24″ × 24″.",
      "Поставьте два маркера обломков на центральной линии. В этом сценарии они считаются плавающими обломками.",
      "Каждый адмирал размещает свою модель по центру собственного края поля.",
    ],
    objective:
      "Первый адмирал, искалечивший вражеский отряд, побеждает и получает 3 очка кампании. Если к концу третьего раунда этого не произошло, 2 очка получает сторона, нанёсшая больше повреждений; при равенстве обе стороны получают по 1 очку.",
    specialObjective:
      "Первый адмирал, чья модель завершит активацию полностью на половине противника, получает 1 очко кампании.",
    specialRules: [
      {
        title: "Плавающие обломки",
        text: "При контакте с маркером обломков движущаяся модель немедленно получает 1 уровень беспорядка, после чего продолжает движение. Маркер не удаляется.",
      },
    ],
    markers: [
      { kind: "wreck", x: 32, y: 50 },
      { kind: "wreck", x: 68, y: 50 },
    ],
    crown: [{ profileId: "pembroke", models: 1 }],
    empire: [{ profileId: "buredo", models: 1 }],
  },
  {
    id: "act-2",
    act: 2,
    title: "Battle Commences",
    titleRu: "Битва начинается",
    battlefield: "24″ × 24″",
    rounds: 3,
    initiative: "В первом раунде инициатива у Империи",
    narrative:
      "После захвата перерабатывающего комплекса к рифу прибывают главные силы обеих сторон. Флагман Короны входит в поле мин, где его уже ждёт эскадра Империи.",
    principles: ["Видимость", "Особенности местности", "Отряды из нескольких моделей"],
    setup: [
      "Разметьте игровое поле 24″ × 24″.",
      "Поставьте два минных поля на центральной линии и одну морскую платформу в центре.",
      "Платформа считается сооружением с Mass 3 и Armour 3.",
      "Начиная с Империи, адмиралы по очереди размещают отряды у своих краёв поля.",
    ],
    objective:
      "После трёх раундов адмирал, искалечивший больше моделей противника, получает 3 очка кампании. При равенстве обе стороны получают по 2 очка.",
    specialObjective:
      "Первый адмирал, искалечивший вражескую модель атакой Broadside, получает 1 очко кампании.",
    specialRules: [],
    markers: [
      { kind: "mine", x: 30, y: 50 },
      { kind: "platform", x: 50, y: 50 },
      { kind: "mine", x: 70, y: 50 },
    ],
    crown: [
      { profileId: "strikakulam", models: 1 },
      { profileId: "kamarupa", models: 2 },
    ],
    empire: [
      { profileId: "nagato", models: 1 },
      { profileId: "taiyo-furea", models: 2 },
    ],
  },
  {
    id: "act-3",
    act: 3,
    title: "The Deep Breath",
    titleRu: "Глубокий вдох",
    battlefield: "24″ × 24″",
    rounds: 4,
    initiative: "В первом раунде инициатива у Короны",
    narrative:
      "Бой распространяется по всему рифу. Подводные силы Короны выходят из глубины, а Империя отвечает появлением драконического колосса Dìyù Huǒ.",
    principles: [
      "Воздушные и подводные отряды",
      "Критические эффекты",
      "Особые качества атак",
      "Обслуживание",
    ],
    setup: [
      "Разметьте игровое поле 24″ × 24″.",
      "Поставьте две морские платформы, как показано на схеме.",
      "Обе платформы считаются сооружениями с Mass 3 и Armour 3.",
      "Начиная с Короны, адмиралы по очереди размещают отряды у своих краёв поля.",
    ],
    objective:
      "Первый адмирал, искалечивший все модели противника, получает 3 очка кампании. Иначе после четвёртого раунда 2 очка получает сторона с большим числом искалеченных моделей; при равенстве обе стороны получают по 1 очку.",
    specialObjective:
      "Первый адмирал, успешно наложивший на врага критический эффект, получает 1 очко кампании.",
    specialRules: [
      {
        title: "Запас Хранителя Короны — 5 кубиков",
        text: "При атаке на модель с Guardian Generator адмирал Короны может добавить к броску сопротивления кубики из общего запаса, но не больше значения Defences цели. В конце раунда запас восстанавливается до начального значения.",
      },
      {
        title: "Доктрина Kanabō Империи",
        text: "Если модель получает хотя бы 1 повреждение от атаки отряда Империи, кроме Submerged Weapons, она немедленно получает 1 уровень беспорядка. Это заменяет правило Under Fire.",
      },
    ],
    markers: [
      { kind: "platform", x: 28, y: 66 },
      { kind: "platform", x: 72, y: 34 },
    ],
    crown: [
      { profileId: "strikakulam", models: 1 },
      { profileId: "kamarupa", models: 2 },
      { profileId: "chaudharys-revenge", models: 2 },
      { profileId: "skua", models: 2 },
    ],
    empire: [
      { profileId: "nagato", models: 1 },
      { profileId: "taiyo-furea", models: 2 },
      { profileId: "buredo", models: 1 },
      { profileId: "diyu-huo", models: 1 },
    ],
  },
  {
    id: "act-4",
    act: 4,
    title: "Closing In",
    titleRu: "Кольцо сжимается",
    battlefield: "36″ × 36″",
    rounds: 4,
    initiative: "В первом раунде инициатива у Империи",
    narrative:
      "Адмирал Империи отступает к перерабатывающему комплексу, увлекая флот Короны за собой. На поле появляются эскорты и абордажные отряды.",
    principles: ["Абордажные действия", "Эскорты"],
    setup: [
      "Разметьте игровое поле 36″ × 36″.",
      "Поставьте две морские платформы и два минных поля на центральной линии.",
      "Платформы считаются сооружениями с Mass 3 и Armour 3.",
      "Начиная с Империи, адмиралы по очереди размещают отряды у своих краёв поля.",
    ],
    objective:
      "Первый адмирал, искалечивший все модели противника, получает 3 очка кампании. Иначе после четвёртого раунда 2 очка получает сторона с большим числом искалеченных моделей; при равенстве обе стороны получают по 1 очку.",
    specialObjective:
      "Первый адмирал, наложивший критический эффект успешным абордажным действием, получает 1 очко кампании.",
    specialRules: [
      {
        title: "Запас Хранителя Короны — 8 кубиков",
        text: "Корона начинает сценарий с 8 кубиками в запасе Хранителя и восстанавливает запас до этого значения в конце раунда.",
      },
    ],
    markers: [
      { kind: "platform", x: 25, y: 50 },
      { kind: "mine", x: 43, y: 50 },
      { kind: "mine", x: 57, y: 50 },
      { kind: "platform", x: 75, y: 50 },
    ],
    crown: [
      { profileId: "strikakulam", models: 1, escorts: 2 },
      { profileId: "kamarupa", models: 2 },
      { profileId: "pembroke", models: 1 },
      { profileId: "chaudharys-revenge", models: 2 },
      { profileId: "tulwar", models: 2 },
      { profileId: "skua", models: 2, escorts: 2 },
    ],
    empire: [
      { profileId: "nagato", models: 1, escorts: 2 },
      { profileId: "taiyo-furea", models: 2 },
      { profileId: "buredo", models: 1, escorts: 2 },
      { profileId: "shinsei", models: 1 },
      { profileId: "diyu-huo", models: 1 },
      { profileId: "ssang", models: 2 },
    ],
  },
  {
    id: "act-5",
    act: 5,
    title: "A Dominion Decided",
    titleRu: "Судьба доминиона",
    battlefield: "36″ × 36″",
    rounds: 5,
    initiative: "Первым адмиралом становится игрок с картой Victory & Valour большего достоинства",
    narrative:
      "Риф горит, а два старых соперника сходятся в решающем бою у Ashmore Refinery. В сражение вступают все силы кампании, включая автоматические мины и сам комплекс.",
    principles: ["Все изученные правила", "Продвинутые повреждения", "Victory & Valour Cards"],
    setup: [
      "Разметьте игровое поле 36″ × 36″.",
      "Поставьте две морские платформы, два минных поля и Ashmore Refinery по схеме.",
      "Оба адмирала открывают верхнюю карту Victory & Valour; более высокое значение определяет Первого адмирала. Затем каждый берёт руку из 5 карт.",
      "Отряды Bun’ya Automata размещаются полностью в пределах 3″ от Ashmore Refinery; остальные отряды — у своего края поля.",
    ],
    objective:
      "Первый адмирал, искалечивший все модели противника, получает 6 очков кампании. Иначе после пятого раунда 3 очка получает сторона с большим числом искалеченных моделей; при равенстве обе стороны получают по 1 очку.",
    specialObjective:
      "Катастрофический взрыв вражеской модели приносит 1 очко, максимум 5. Корона получает 3 очка за первую Broadside-атаку Strikakulam по Nagato. Империя получает 2 очка за первый успешный абордаж Shinsei против Sentosa.",
    specialRules: [
      {
        title: "Запас Хранителя Короны — 8 кубиков",
        text: "Корона начинает сценарий с 8 кубиками в запасе Хранителя и восстанавливает запас до этого значения в конце раунда.",
      },
      {
        title: "Два отряда Bun’ya",
        text: "Империя использует два отдельных отряда Bun’ya Automata. Оба используют один и тот же кампанийный профиль.",
      },
    ],
    markers: [
      { kind: "platform", x: 30, y: 30 },
      { kind: "mine", x: 70, y: 30 },
      { kind: "refinery", x: 50, y: 50 },
      { kind: "mine", x: 30, y: 70 },
      { kind: "platform", x: 70, y: 70 },
    ],
    crown: [
      { profileId: "strikakulam", models: 1, escorts: 2 },
      { profileId: "kamarupa", models: 2 },
      { profileId: "pembroke", models: 1, escorts: 2 },
      { profileId: "chaudharys-revenge", models: 2 },
      { profileId: "tulwar", models: 2 },
      { profileId: "skua", models: 2, escorts: 2 },
      { profileId: "crows", models: 2 },
      { profileId: "sentosa", models: 1, escorts: 2 },
    ],
    empire: [
      { profileId: "nagato", models: 1, escorts: 2 },
      { profileId: "taiyo-furea", models: 2 },
      { profileId: "buredo", models: 1, escorts: 2 },
      { profileId: "shinsei", models: 1 },
      { profileId: "diyu-huo", models: 1 },
      { profileId: "ssang", models: 2 },
      { profileId: "bunya", models: 2 },
      { profileId: "bunya", models: 2 },
      { profileId: "ashmore-refinery", models: 1 },
    ],
  },
] as const;

export function campaignScenario(id: string | undefined): CampaignScenario {
  return campaignScenarios.find((scenario) => scenario.id === id) ?? campaignScenarios[0]!;
}

export function campaignProfile(id: string): CampaignProfile {
  const profile = profiles.find((candidate) => candidate.id === id);
  if (!profile) throw new Error(`Unknown campaign profile: ${id}`);
  return profile;
}

export function campaignProfileModel(unit: CampaignFleetUnit): {
  readonly faction: CampaignFaction;
  readonly model: ShipEditorReadyReadModel;
  readonly role: string;
} {
  const profile = campaignProfile(unit.profileId);
  const propertyText = profile.properties.join(", ");
  const allRules = uniqueRules([
    ...rulesForText(propertyText),
    ...profile.systems.flatMap(rulesForText),
    ...profile.weapons.flatMap((entry) => rulesForText(entry.qualities ?? "")),
  ]);
  const rows = Object.entries(profile.stats).map(([label, value]) => ({
    id: `${profile.id}:stat:${label}`,
    label,
    value: textPresentation(value),
    provenance: null,
  }));
  rows.push({
    id: `${profile.id}:models`,
    label: "Models",
    value: textPresentation(String(unit.models)),
    provenance: null,
  });

  const weapons: readonly WeaponProfileReadModel[] = profile.weapons.map((entry, index) => ({
    id: `${profile.id}:weapon:${index}`,
    weapon: entry.name,
    arc: entry.arc,
    close: entry.close,
    standard: entry.standard,
    extreme: entry.extreme,
    qualities: entry.qualities ?? "",
    qualityRules: rulesForText(entry.qualities ?? ""),
    provenance: null,
  }));

  const escorts = unit.escorts ?? 0;
  const model: ShipEditorReadyReadModel = {
    dataState: "ready",
    mode: "preview",
    instanceId: null,
    name: profile.name,
    card: {
      role: profile.role,
      tags: profile.tags,
      nation: profile.tags[1] ?? profile.faction,
      platform: profile.tags[2] ?? "",
    },
    basePoints: "—",
    optionPoints: "—",
    derivedPoints: "—",
    totalPoints: "—",
    victoryPoints: "—",
    mandatory: { selected: 0, required: 0 },
    validity: "valid",
    persistence: "saved-local",
    system: "ready",
    groups: [
      {
        id: `${profile.id}:escorts`,
        label: "Escorts",
        help: "Фиксировано сценарием",
        scope: "unit",
        control: "quantity",
        minimum: escorts,
        maximum: escorts,
        options: [],
      },
    ],
    fleetGroups: [],
    modelQuantity: {
      instanceId: null,
      value: unit.models,
      minimum: unit.models,
      maximum: unit.models,
      fixed: true,
    },
    problems: [],
    breakdown: [{ label: "Кампанийный профиль", value: "Dominion of the Dragon" }],
    profileRules: {
      variant: "base",
      sourceCatalogVersion: "Dominion of the Dragon",
      versionState: "current",
      sections: [
        { id: "model", label: "Model", rows },
        {
          id: "properties",
          label: "Properties",
          rows: propertyText
            ? [
                {
                  id: `${profile.id}:properties`,
                  label: "Properties",
                  value: textPresentation(propertyText),
                  rules: rulesForText(propertyText),
                  provenance: null,
                },
              ]
            : [],
        },
        {
          id: "systems",
          label: "Systems",
          rows: profile.systems.map((system, index) => ({
            id: `${profile.id}:system:${index}`,
            label: system,
            value: textPresentation("Installed"),
            rules: rulesForText(system),
            provenance: null,
          })),
        },
      ],
      weapons,
      rules: allRules,
      diagnostics: [],
    },
  };
  return { faction: profile.faction, model, role: profile.role };
}

function weapon(
  name: string,
  arc: string,
  close: string,
  standard: string,
  extreme: string,
  qualities?: string,
): CampaignWeapon {
  return { name, arc, close, standard, extreme, ...(qualities ? { qualities } : {}) };
}

function textPresentation(value: string): SafePresentation {
  return {
    plainText: value,
    blocks: [{ type: "paragraph", children: [{ type: "text", value }] }],
    contentUnavailable: false,
    diagnostics: [],
  };
}

function rulesForText(value: string): readonly RuleReadModel[] {
  const normalized = value.toLocaleLowerCase("en");
  return campaignRules.filter((rule) => normalized.includes(rule.label.toLocaleLowerCase("en")));
}

function uniqueRules(rules: readonly RuleReadModel[]): readonly RuleReadModel[] {
  return [...new Map(rules.map((rule) => [rule.id, rule])).values()];
}
