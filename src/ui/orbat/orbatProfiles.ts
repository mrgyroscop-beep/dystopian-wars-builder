export const orbatProfileCategories = [
  "Flagship",
  "Line",
  "Patrol",
  "Support",
  "Scout",
  "Logistical",
] as const;

export type OrbatProfileCategory = (typeof orbatProfileCategories)[number];

export interface OrbatProfile {
  id: string;
  name: string;
  faction: "Empire";
  category: OrbatProfileCategory;
  page: number;
  sourceVersion: "4.01";
}

const profile = (
  id: string,
  name: string,
  category: OrbatProfileCategory,
  page: number,
): OrbatProfile => ({
  id,
  name,
  faction: "Empire",
  category,
  page,
  sourceVersion: "4.01",
});

export const empireOrbatProfiles: readonly OrbatProfile[] = [
  profile("akita-super-battleship", "Akita Super Battleship", "Flagship", 23),
  profile("ergun-battleship", "Ergun Battleship", "Flagship", 24),
  profile("hachiman-grand-carrier", "Hachiman Grand Carrier", "Flagship", 25),
  profile("heilong-battleship", "Heilong Battleship", "Flagship", 26),
  profile("kongo-heavy-battleship", "Kongo Heavy Battleship", "Flagship", 27),
  profile("matsumoto-generator-ship", "Matsumoto Generator Ship", "Flagship", 28),
  profile("naraka-battleship", "Naraka Battleship", "Flagship", 29),
  profile("ning-jing-battleship", "Ning Jing Battleship", "Flagship", 30),
  profile("oni-command-cruiser", "Oni Command Cruiser", "Flagship", 31),
  profile("tianlong-draconic-colossus", "Tianlong Draconic Colossus", "Flagship", 32),
  profile("yangtze-command-ship", "Yangtze Command Ship", "Flagship", 33),
  profile("zhanmadao-skyfortress", "Zhanmadao Skyfortress", "Flagship", 34),
  profile("yuzhou-city-of-furnaces", "Yuzhou, City of Furnaces", "Flagship", 35),
  profile("dao-light-cruiser", "Dao Light Cruiser", "Line", 36),
  profile("diyu-immolation-cruiser", "Diyu Immolation Cruiser", "Line", 37),
  profile("hokkaido-heavy-cruiser", "Hokkaido Heavy Cruiser", "Line", 38),
  profile("jian-cruiser", "Jian Cruiser", "Line", 39),
  profile("meru-heavy-cruiser", "Meru Heavy Cruiser", "Line", 40),
  profile("osaka-cruiser", "Osaka Cruiser", "Line", 41),
  profile("qiang-cruiser", "Qiang Cruiser", "Line", 42),
  profile("ryujin-submarine", "Ryujin Submarine", "Line", 43),
  profile("sakata-heavy-destroyer", "Sakata Heavy Destroyer", "Line", 44),
  profile("gangcheori-draconic-colossus", "Gangcheori Draconic Colossus", "Patrol", 45),
  profile("gong-destroyer", "Gong Destroyer", "Patrol", 46),
  profile("hexie-hover-zebek", "Hexie Hover Zebek", "Patrol", 47),
  profile("honshu-light-cruiser", "Honshu Light Cruiser", "Patrol", 48),
  profile("kanagawa-heavy-monitor", "Kanagawa Heavy Monitor", "Patrol", 49),
  profile("kansai-torpedo-submarine", "Kansai Torpedo Submarine", "Patrol", 50),
  profile("kiyohime-draconic-colossus", "Kiyohime Draconic Colossus", "Patrol", 51),
  profile("kyoto-fast-frigate", "Kyoto Fast Frigate", "Patrol", 52),
  profile("miyagi-advanced-monitor", "Miyagi Advanced Monitor", "Patrol", 53),
  profile("shanghai-frigate", "Shanghai Frigate", "Patrol", 54),
  profile("shenlong-draconic-colossus", "Shenlong Draconic Colossus", "Patrol", 55),
  profile("wusong-monitor", "Wusong Monitor", "Patrol", 56),
  profile("bangpae-explosive-automata", "Bangpae Explosive Automata", "Support", 57),
  profile("defence-platform", "Defence Platform", "Support", 58),
  profile("heavy-platform", "Heavy Platform", "Support", 59),
  profile("hwanung-generator-aircruiser", "Hwanung Generator Aircruiser", "Support", 60),
  profile("ikuchi-exo-submersible-carrier", "Ikuchi Exo-Submersible Carrier", "Support", 61),
  profile("kaiju-ika-colossus", "Kaiju Ika Colossus", "Support", 62),
  profile("koromodako-attack-submarine", "Koromodako Attack Submarine", "Support", 63),
  profile("mekong-assault-cruiser", "Mekong Assault Cruiser", "Support", 64),
  profile("ofukoro-ika-colossus", "Ofukoro Ika Colossus", "Support", 65),
  profile("qianshao-sky-keep", "Qianshao Sky Keep", "Support", 66),
  profile("sanshin-judgement-aircruiser", "Sanshin Judgement Aircruiser", "Support", 67),
  profile("yamaguchi-advanced-cruiser", "Yamaguchi Advanced Cruiser", "Support", 68),
  profile("yanshi-firebase", "Yanshi Firebase", "Support", 69),
  profile("yaoji-bombardment-cruiser", "Yaoji Bombardment Cruiser", "Support", 70),
  profile("ziwei-sky-bastion", "Ziwei Sky Bastion", "Support", 71),
  profile("chubu-submarine", "Chubu Submarine", "Scout", 72),
  profile("hobakbeol-assault-rotor", "Hobakbeol Assault Rotor", "Scout", 73),
  profile("umibozu-attack-submarine", "Umibozu Attack Submarine", "Scout", 74),
  profile("europa-grand-conveyor", "Europa Grand Conveyor", "Logistical", 75),
  profile("hermes-supply-freighter", "Hermes Supply Freighter", "Logistical", 76),
  profile("lantau-merchantman", "Lantau Merchantman", "Logistical", 77),
  profile("supply-platform", "Supply Platform", "Logistical", 78),
  profile("titan-mass-conveyor", "Titan Mass Conveyor", "Logistical", 79),
  profile("wuhan-repair-ship", "Wuhan Repair Ship", "Logistical", 80),
];

export function getOrbatProfileImage(profileEntry: OrbatProfile): string {
  const page = profileEntry.page.toString().padStart(3, "0");
  return `/orbats/empire/${profileEntry.sourceVersion}/profile-page-${page}.webp`;
}
