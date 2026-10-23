import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { writeDaily, writeMeta } from "../../lib/library/store";
import {
  anpFileUrl, brAnswerFromRow, brDailyRows, brFuelNow, brHarvest, brHistoryKey, brState, candidateMonths, latestWeek, parseAnpCsv, resolveBrPlace,
} from "./source";

// Rows copied from ANP's real September 2026 files (probe of 14 Oct 2026):
//   .../shpc/dsan/2026/09-dados-abertos-precos-2026-09-gasolina-etanol.csv and ...-diesel-gnv.csv
// (the first rows of each file, ';' separated, decimal comma; every row is dated 01/09/2026).
const H_GAS = "Regiao - Sigla;Estado - Sigla;Municipio;Revenda;CNPJ da Revenda;Nome da Rua;Numero Rua;Complemento;Bairro;Cep;Produto;Data da Coleta;Valor de Venda;Valor de Compra;Unidade de Medida;Bandeira";
const GAS = [
  "N;AC;RIO BRANCO;AUTO POSTO CIDADE LTDA; 06.321.359/0001-47;AVENIDA NACOES UNIDAS;2123;;7 BEC;69918-093;GASOLINA;01/09/2026;7,25;;R$ / litro;VIBRA",
  "N;AC;RIO BRANCO;AUTO POSTO CIDADE LTDA; 06.321.359/0001-47;AVENIDA NACOES UNIDAS;2123;;7 BEC;69918-093;GASOLINA ADITIVADA;01/09/2026;7,25;;R$ / litro;VIBRA",
  "N;AC;RIO BRANCO;AUTO POSTO CIDADE LTDA; 06.321.359/0001-47;AVENIDA NACOES UNIDAS;2123;;7 BEC;69918-093;ETANOL;01/09/2026;4,65;;R$ / litro;VIBRA",
  "NE;BA;JACOBINA;PARENTES REVENDA DE PRODUTOS DE PETROLEO LTDA.; 05.481.141/0001-97;AVENIDA CENTENARIO;1600;;NAZARE;44700-000;GASOLINA;01/09/2026;6,85;;R$ / litro;BRANCA",
  "NE;BA;JACOBINA;PARENTES REVENDA DE PRODUTOS DE PETROLEO LTDA.; 05.481.141/0001-97;AVENIDA CENTENARIO;1600;;NAZARE;44700-000;GASOLINA ADITIVADA;01/09/2026;6,85;;R$ / litro;BRANCA",
  "NE;BA;JACOBINA;PARENTES REVENDA DE PRODUTOS DE PETROLEO LTDA.; 05.481.141/0001-97;AVENIDA CENTENARIO;1600;;NAZARE;44700-000;ETANOL;01/09/2026;4,60;;R$ / litro;BRANCA",
  "NE;BA;JACOBINA;TROPICAL COMBUSTIVEIS E LUBRIFICANTES LTDA; 07.856.330/0001-22;RUA FRANCISCO ROCHA PIRES;300;;CENTRO;44700-000;GASOLINA;01/09/2026;6,89;;R$ / litro;BRANCA",
  "NE;BA;JACOBINA;TROPICAL COMBUSTIVEIS E LUBRIFICANTES LTDA; 07.856.330/0001-22;RUA FRANCISCO ROCHA PIRES;300;;CENTRO;44700-000;ETANOL;01/09/2026;4,55;;R$ / litro;BRANCA",
  "NE;BA;PORTO SEGURO;PORTAL POSTO DE COMBUSTIVEIS LTDA; 07.064.096/0001-09;AVENIDA ADNO MUSSER;3600;TERREO;CAMBOLO;45810-000;GASOLINA;01/09/2026;6,95;;R$ / litro;VIBRA",
  "NE;BA;PORTO SEGURO;PORTAL POSTO DE COMBUSTIVEIS LTDA; 07.064.096/0001-09;AVENIDA ADNO MUSSER;3600;TERREO;CAMBOLO;45810-000;GASOLINA ADITIVADA;01/09/2026;7,05;;R$ / litro;VIBRA",
  "NE;BA;PORTO SEGURO;PORTAL POSTO DE COMBUSTIVEIS LTDA; 07.064.096/0001-09;AVENIDA ADNO MUSSER;3600;TERREO;CAMBOLO;45810-000;ETANOL;01/09/2026;4,95;;R$ / litro;VIBRA",
  "NE;BA;PORTO SEGURO;SULBAHIA COMBUSTIVEIS LTDA; 05.841.787/0001-38;AVENIDA ADNO MUSSER;3200;;MIRANTE CARAVELAS;45810-000;GASOLINA;01/09/2026;6,95;;R$ / litro;RAIZEN",
  "NE;BA;PORTO SEGURO;SULBAHIA COMBUSTIVEIS LTDA; 05.841.787/0001-38;AVENIDA ADNO MUSSER;3200;;MIRANTE CARAVELAS;45810-000;GASOLINA ADITIVADA;01/09/2026;7,05;;R$ / litro;RAIZEN",
  "NE;BA;PORTO SEGURO;SULBAHIA COMBUSTIVEIS LTDA; 05.841.787/0001-38;AVENIDA ADNO MUSSER;3200;;MIRANTE CARAVELAS;45810-000;ETANOL;01/09/2026;4,95;;R$ / litro;RAIZEN",
  "NE;BA;PORTO SEGURO;LESTE DERIVADOS DE PETROLEO LTDA; 01.700.901/0001-59;AVENIDA ADNO MUSSER;1960;LOT PARQUE RESIDENCIAL TABAPIRI;TABAPIRI;45810-000;GASOLINA;01/09/2026;6,95;;R$ / litro;RAIZEN",
  "NE;BA;PORTO SEGURO;LESTE DERIVADOS DE PETROLEO LTDA; 01.700.901/0001-59;AVENIDA ADNO MUSSER;1960;LOT PARQUE RESIDENCIAL TABAPIRI;TABAPIRI;45810-000;GASOLINA ADITIVADA;01/09/2026;7,05;;R$ / litro;RAIZEN",
  "NE;BA;PORTO SEGURO;LESTE DERIVADOS DE PETROLEO LTDA; 01.700.901/0001-59;AVENIDA ADNO MUSSER;1960;LOT PARQUE RESIDENCIAL TABAPIRI;TABAPIRI;45810-000;ETANOL;01/09/2026;4,95;;R$ / litro;RAIZEN",
  "NE;BA;SALVADOR;ECOPOSTOS - COMBUSTIVEIS E SERVICOS LTDA; 04.420.464/0004-50;AVENIDA BARROS REIS - LADO PAR;2938;ARRAIAL DO RETIRO;ARRAIAL DO RETIRO;41204-025;GASOLINA ADITIVADA;01/09/2026;6,69;;R$ / litro;VIBRA",
  "NE;BA;SALVADOR;J&J COMBUSTIVEIS LTDA; 06.115.130/0001-56;AVENIDA ANTONIO CARLOS MAGALHAES;5863;;SANTA TERESA;40265-200;GASOLINA;01/09/2026;6,54;;R$ / litro;IPIRANGA",
  "NE;BA;SALVADOR;J&J COMBUSTIVEIS LTDA; 06.115.130/0001-56;AVENIDA ANTONIO CARLOS MAGALHAES;5863;;SANTA TERESA;40265-200;ETANOL;01/09/2026;4,89;;R$ / litro;IPIRANGA",
  "NE;BA;SALVADOR;PACIFICO COMERCIO E SERVICOS DE COMBUSTIVEIS LTDA; 06.948.623/0001-77;AVENIDA SANTA LUZIA;1137;;HORTO FLORESTAL;40295-050;GASOLINA;01/09/2026;7,39;;R$ / litro;VIBRA",
  "NE;BA;SALVADOR;PACIFICO COMERCIO E SERVICOS DE COMBUSTIVEIS LTDA; 06.948.623/0001-77;AVENIDA SANTA LUZIA;1137;;HORTO FLORESTAL;40295-050;GASOLINA ADITIVADA;01/09/2026;7,59;;R$ / litro;VIBRA",
  "NE;BA;SALVADOR;PACIFICO COMERCIO E SERVICOS DE COMBUSTIVEIS LTDA; 06.948.623/0001-77;AVENIDA SANTA LUZIA;1137;;HORTO FLORESTAL;40295-050;ETANOL;01/09/2026;5,19;;R$ / litro;VIBRA",
  "NE;BA;SALVADOR;GAS ON LINE COMERCIO E SERVICOS LTDA; 05.033.611/0001-50;AVENIDA HEITOR DIAS;735;;PAU MIUDO;40315-518;GASOLINA;01/09/2026;6,95;;R$ / litro;LARCO",
  "NE;BA;SALVADOR;GAS ON LINE COMERCIO E SERVICOS LTDA; 05.033.611/0001-50;AVENIDA HEITOR DIAS;735;;PAU MIUDO;40315-518;GASOLINA ADITIVADA;01/09/2026;6,99;;R$ / litro;LARCO",
  "NE;BA;SALVADOR;GAS ON LINE COMERCIO E SERVICOS LTDA; 05.033.611/0001-50;AVENIDA HEITOR DIAS;735;;PAU MIUDO;40315-518;ETANOL;01/09/2026;4,85;;R$ / litro;LARCO",
  "NE;BA;SALVADOR;J A SOBRAL & CIA LTDA; 13.799.101/0001-16;AVENIDA MARIO LEAL FERREIRA (S AC NORTE);509;TERREO;BROTAS;40285-600;GASOLINA;01/09/2026;6,13;;R$ / litro;VIBRA",
  "NE;BA;SALVADOR;J A SOBRAL & CIA LTDA; 13.799.101/0001-16;AVENIDA MARIO LEAL FERREIRA (S AC NORTE);509;TERREO;BROTAS;40285-600;GASOLINA ADITIVADA;01/09/2026;6,33;;R$ / litro;VIBRA",
  "NE;BA;SALVADOR;J A SOBRAL & CIA LTDA; 13.799.101/0001-16;AVENIDA MARIO LEAL FERREIRA (S AC NORTE);509;TERREO;BROTAS;40285-600;ETANOL;01/09/2026;3,97;;R$ / litro;VIBRA",
  "NE;BA;SALVADOR;HIPER POSTO CAMINHO DAS ARVORES LTDA; 34.276.766/0001-15;AVENIDA TANCREDO NEVES;1506;GLEBA 1;CAMINHO DAS ARVORES;41820-020;GASOLINA;01/09/2026;6,13;;R$ / litro;RAIZEN",
  "NE;BA;SALVADOR;HIPER POSTO CAMINHO DAS ARVORES LTDA; 34.276.766/0001-15;AVENIDA TANCREDO NEVES;1506;GLEBA 1;CAMINHO DAS ARVORES;41820-020;GASOLINA ADITIVADA;01/09/2026;6,53;;R$ / litro;RAIZEN",
  "NE;BA;SALVADOR;HIPER POSTO CAMINHO DAS ARVORES LTDA; 34.276.766/0001-15;AVENIDA TANCREDO NEVES;1506;GLEBA 1;CAMINHO DAS ARVORES;41820-020;ETANOL;01/09/2026;4,59;;R$ / litro;RAIZEN",
  "NE;BA;SALVADOR;POSTO CASAGRANDE LTDA; 05.125.819/0001-07;RUA FREDERICO COSTA;7;BOA VISTA DE BROTAS;BROTAS;40243-045;GASOLINA;01/09/2026;6,13;;R$ / litro;BRANCA",
];
const H_DIE = "Regiao - Sigla;Estado - Sigla;Municipio;Revenda;CNPJ da Revenda;Nome da Rua;Numero Rua;Complemento;Bairro;Cep;Produto;Data da Coleta;Valor de Venda;Valor de Compra;Unidade de Medida;Bandeira";
const DIE = [
  "NE;BA;JACOBINA;PARENTES REVENDA DE PRODUTOS DE PETROLEO LTDA.; 05.481.141/0001-97;AVENIDA CENTENARIO;1600;;NAZARE;44700-000;DIESEL;01/09/2026;6,85;;R$ / litro;BRANCA",
  "NE;BA;JACOBINA;PARENTES REVENDA DE PRODUTOS DE PETROLEO LTDA.; 05.481.141/0001-97;AVENIDA CENTENARIO;1600;;NAZARE;44700-000;DIESEL S10;01/09/2026;7,35;;R$ / litro;BRANCA",
  "NE;BA;PORTO SEGURO;PORTAL POSTO DE COMBUSTIVEIS LTDA; 07.064.096/0001-09;AVENIDA ADNO MUSSER;3600;TERREO;CAMBOLO;45810-000;DIESEL;01/09/2026;7,95;;R$ / litro;VIBRA",
  "NE;BA;PORTO SEGURO;PORTAL POSTO DE COMBUSTIVEIS LTDA; 07.064.096/0001-09;AVENIDA ADNO MUSSER;3600;TERREO;CAMBOLO;45810-000;DIESEL S10;01/09/2026;8,05;;R$ / litro;VIBRA",
  "NE;BA;PORTO SEGURO;SULBAHIA COMBUSTIVEIS LTDA; 05.841.787/0001-38;AVENIDA ADNO MUSSER;3200;;MIRANTE CARAVELAS;45810-000;DIESEL;01/09/2026;7,95;;R$ / litro;RAIZEN",
  "NE;BA;PORTO SEGURO;SULBAHIA COMBUSTIVEIS LTDA; 05.841.787/0001-38;AVENIDA ADNO MUSSER;3200;;MIRANTE CARAVELAS;45810-000;DIESEL S10;01/09/2026;8,05;;R$ / litro;RAIZEN",
  "NE;BA;PORTO SEGURO;LESTE DERIVADOS DE PETROLEO LTDA; 01.700.901/0001-59;AVENIDA ADNO MUSSER;1960;LOT PARQUE RESIDENCIAL TABAPIRI;TABAPIRI;45810-000;DIESEL;01/09/2026;8,05;;R$ / litro;RAIZEN",
  "NE;BA;SALVADOR;GAS ON LINE COMERCIO E SERVICOS LTDA; 05.033.611/0001-50;AVENIDA HEITOR DIAS;735;;PAU MIUDO;40315-518;DIESEL S10;01/09/2026;7,49;;R$ / litro;LARCO",
  "NE;BA;SALVADOR;J A SOBRAL & CIA LTDA; 13.799.101/0001-16;AVENIDA MARIO LEAL FERREIRA (S AC NORTE);509;TERREO;BROTAS;40285-600;DIESEL S10;01/09/2026;7,20;;R$ / litro;VIBRA",
  "NE;BA;SALVADOR;POSTO DE GASOLINA FELICI LTDA; 00.138.957/0001-07;AVENIDA PRESIDENTE CASTELO BRANCO;SN;;SAUDE;40045-050;DIESEL S10;01/09/2026;7,05;;R$ / litro;VIBRA",
  "NE;CE;JUAZEIRO DO NORTE;ARAUJO PETROLEO LTDA; 00.089.746/0002-02;AVENIDA CASTELO BRANCO;253;;SANTA TERESA;63050-480;DIESEL;01/09/2026;6,79;;R$ / litro;VIBRA",
  "NE;CE;JUAZEIRO DO NORTE;ARAUJO PETROLEO LTDA; 00.089.746/0002-02;AVENIDA CASTELO BRANCO;253;;SANTA TERESA;63050-480;DIESEL S10;01/09/2026;7,09;;R$ / litro;VIBRA",
  "NE;CE;JUAZEIRO DO NORTE;TRIBUS COMERCIO DE COMBUSTVEIS LTDA.; 04.314.770/0002-40;AVENIDA PADRE CICERO;5211;;SAO JOSE;63041-140;DIESEL S10;01/09/2026;6,93;;R$ / litro;BRANCA",
  "NE;CE;JUAZEIRO DO NORTE;TRIBUS COMERCIO DE COMBUSTVEIS LTDA.; 04.314.770/0002-40;AVENIDA PADRE CICERO;5211;;SAO JOSE;63041-140;DIESEL;01/09/2026;6,80;;R$ / litro;BRANCA",
  "NE;CE;JUAZEIRO DO NORTE;MARCIANO COMERCIO DE COMBUSTIVEIS E LUBRIFICANTES LTDA; 07.053.903/0004-22;AVENIDA PADRE CICERO;2506;;CAJUINA SAO GERALDO;63022-115;DIESEL S10;01/09/2026;7,69;;R$ / litro;BRANCA",
  "NE;CE;QUIXADA;POSTO MONOLITOS LTDA; 05.159.709/0001-58;AVENIDA PLACIDO  CASTELO;1599;;CENTRO;63900-002;DIESEL S10;01/09/2026;6,79;;R$ / litro;VIBRA",
  "SE;ES;VILA VELHA;A.B.C. AUTO SERVICOS LTDA; 28.059.632/0001-40;AVENIDA ROBERT KENNEDY;21;A;SAO TORQUATO;29114-000;DIESEL;01/09/2026;6,69;;R$ / litro;RAIZEN",
  "SE;ES;VILA VELHA;A.B.C. AUTO SERVICOS LTDA; 28.059.632/0001-40;AVENIDA ROBERT KENNEDY;21;A;SAO TORQUATO;29114-000;DIESEL S10;01/09/2026;6,79;;R$ / litro;RAIZEN",
  "SE;ES;VILA VELHA;POSTO TRES COQUEIROS LTDA; 36.336.386/0001-54;RODOVIA CARLOS LINDEMBERG;SN;;ALVORADA;29123-600;DIESEL;01/09/2026;6,49;;R$ / litro;IPIRANGA",
  "SE;ES;VILA VELHA;POSTO TRES COQUEIROS LTDA; 36.336.386/0001-54;RODOVIA CARLOS LINDEMBERG;SN;;ALVORADA;29123-600;DIESEL S10;01/09/2026;6,59;;R$ / litro;IPIRANGA",
  "SE;ES;VITORIA;J. S. PETROLEO E COMERCIO LTDA.; 08.788.618/0001-70;AVENIDA DANTE MICHELINI;2461;;MATA DA PRAIA;29066-430;DIESEL S10;01/09/2026;6,89;;R$ / litro;RAIZEN",
  "SE;ES;VITORIA;AUTO POSTO MARLIN LTDA; 04.228.463/0001-66;RUA JUIZ ALEXANDRE MARTINS DE CASTRO FILHO;285;;SANTA LUCIA;29056-295;DIESEL S10;01/09/2026;6,99;;R$ / litro;ATLÂNTICA",
  "SE;ES;VITORIA;POSTO ATLANTICO LTDA; 27.734.094/0001-89;AVENIDA DANTE MICHELINI;4655;POSTO;JARDIM CAMBURI;29090-070;DIESEL S10;01/09/2026;6,79;;R$ / litro;RAIZEN",
  "SE;ES;VITORIA;POSTO ARVOREDO LTDA; 27.066.273/0001-95;AVENIDA VITORIA;2667;;HORTO;29027-080;DIESEL S10;01/09/2026;6,75;;R$ / litro;BRANCA",
  "CO;GO;APARECIDA DE GOIANIA;AUTO POSTO BESSA LTDA; 02.568.878/0002-34;AVENIDA EUCLIDES DA CUNHA;SN;QD.01 LT.01/02/03 E 18;CIDADE SATELITE SAO LUIZ;74920-580;DIESEL S10;01/09/2026;6,39;;R$ / litro;IPIRANGA",
  "CO;GO;APARECIDA DE GOIANIA;JM - COMERCIO DE LUBRIFICANTES LTDA; 05.608.441/0001-94;RUA MONTE CARMELO;SN;MODULO INDUSTRIAL 01 QD. 01;POLO EMPRESARIAL GOIAS;74983-160;DIESEL;01/09/2026;5,89;;R$ / litro;BRANCA",
  "CO;GO;APARECIDA DE GOIANIA;JM - COMERCIO DE LUBRIFICANTES LTDA; 05.608.441/0001-94;RUA MONTE CARMELO;SN;MODULO INDUSTRIAL 01 QD. 01;POLO EMPRESARIAL GOIAS;74983-160;DIESEL S10;01/09/2026;6,29;;R$ / litro;BRANCA",
  "CO;GO;APARECIDA DE GOIANIA;PILOTO COMERCIO DE DERIVADOS DE PETROLEO LTDA; 07.262.086/0001-70;AVENIDA INDEPENDENCIA ESQ. C/ RUA 3;S/N;QD. 04 LT. 01;CIDADE LIVRE;74970-295;DIESEL S10;01/09/2026;6,29;;R$ / litro;IPIRANGA",
  "CO;GO;APARECIDA DE GOIANIA;COMERCIAL CLAMALU LTDA; 05.102.467/0001-66;AVENIDA 13 DE MAIO;S/N;QD.01 LT. 04;CARDOSO - II ETAPA;74934-050;DIESEL;01/09/2026;5,99;;R$ / litro;BRANCA",
  "CO;GO;APARECIDA DE GOIANIA;COMERCIAL CLAMALU LTDA; 05.102.467/0001-66;AVENIDA 13 DE MAIO;S/N;QD.01 LT. 04;CARDOSO - II ETAPA;74934-050;DIESEL S10;01/09/2026;6,49;;R$ / litro;BRANCA",
  "CO;GO;APARECIDA DE GOIANIA;AM SERRA DOURADA COMERCIO DE COMBUSTIVEIS LTDA; 05.736.365/0001-00;RUA IRMAOS MARISTAS;S/N;QD.03, LT.09;SETOR SERRA DOURADA;74973-370;DIESEL S10;01/09/2026;6,39;;R$ / litro;IPIRANGA",
  "CO;GO;APARECIDA DE GOIANIA;GARAVELO AUTO POSTO LTDA; 02.170.231/0001-79;RODOVIA GO-040;SN;QUADRA70                  LOTE  6E;SETOR GARAVELO;74930-520;DIESEL;01/09/2026;6,29;;R$ / litro;VIBRA",
];

const gasCsv = [H_GAS, ...GAS].join("\n");
const dieCsv = [H_DIE, ...DIE].join("\n");

test("BR: ANP rows parse (BOM, ';' separators, decimal comma, dd/mm/yyyy); only petrol and diesel S10 in litres are kept", () => {
  const gas = parseAnpCsv("﻿" + gasCsv);
  assert.equal(gas.length, 12); // GASOLINA only: ETANOL and GASOLINA ADITIVADA are not covered
  assert.deepEqual(gas[0], { uf: "AC", municipality: "RIO BRANCO", product: "GASOLINA", date: "2026-09-01", price: 7.25, station: "06321359000147" });
  const die = parseAnpCsv(dieCsv);
  assert.equal(die.length, 21); // DIESEL S10 only (plain DIESEL is the older S500 and is left out)
  assert.ok(die.every((r) => r.product === "DIESEL S10"));
  assert.throws(() => parseAnpCsv("a;b;c\n1;2;3"), /Unexpected layout/);
  // a price that is not a plausible pump price is dropped
  const odd = [H_GAS, GAS[0].replace("7,25", "0,07"), GAS[0].replace("7,25", "9999,00")].join("\n");
  assert.equal(parseAnpCsv(odd).length, 0);
});

test("BR: the newest survey week keeps one price per station and drops older rows", () => {
  const [a, b] = parseAnpCsv(gasCsv);
  const later = { ...a, date: "2026-09-05", price: 7.4 }; // same station visited again: the later price counts
  const older = { ...b, date: "2026-08-20" }; // more than 6 days before the newest date: not part of the week
  const w = latestWeek([a, later, older]);
  assert.equal(w.date, "2026-09-05");
  assert.equal(w.stations.length, 1);
  assert.equal(w.stations[0].price, 7.4);
  assert.throws(() => latestWeek([]), /no usable prices/);
});

test("BR: library rows for Brazil, each state and each municipality, per fuel", () => {
  const day = brDailyRows([...parseAnpCsv(gasCsv), ...parseAnpCsv(dieCsv)]);
  assert.equal(day.date, "2026-09-01");
  assert.equal(day.currency, "BRL");
  assert.equal(day.unit, "per litre");
  const held = day.rows.filter((r) => r.n >= 5).map((r) => `${r.area}/${r.item}/${r.n}`);
  assert.deepEqual(held, [
    "ALL/diesel/21", "ALL/petrol95/12", "BA/diesel/6", "BA/petrol95/11", "BA:SALVADOR/petrol95/6",
    "ES/diesel/6", "GO/diesel/5", "GO:APARECIDA DE GOIANIA/diesel/5",
  ]);
  const salvador = day.rows.find((r) => r.area === "BA:SALVADOR" && r.item === "petrol95")!;
  assert.deepEqual([salvador.median, salvador.min, salvador.max], [6.335, 6.13, 7.39]);
  assert.match(day.note ?? "", /7 days ending 2026-09-01/);
});

test("BR: states and municipalities resolve (names, codes, accents; state needed only when a name repeats)", () => {
  const index = () => new Map([["SAO PAULO", ["SP"]], ["SALVADOR", ["BA"]], ["SANTA CRUZ", ["RN", "RS"]]]);
  assert.equal(brState("sp"), "SP");
  assert.equal(brState("São Paulo"), "SP");
  assert.equal(brState("Minas Gerais"), "MG");
  assert.equal(brState("Estado de Goiás"), "GO");
  assert.equal(brState("Atlantis"), null);
  assert.deepEqual(resolveBrPlace({}, index), { area: "ALL", label: "Brazil" });
  assert.deepEqual(resolveBrPlace({ area: "SP" }, index), { area: "SP", label: "São Paulo (state)" });
  assert.deepEqual(resolveBrPlace({ town: "São Paulo" }, index), { area: "SP:SAO PAULO", label: "São Paulo, SP" });
  // Gap G20261023-BR-SAO-PAULO: a plus sign that reaches us undecoded (town=são+paulo, or %2B) means a space.
  assert.deepEqual(resolveBrPlace({ town: "são+paulo" }, index), { area: "SP:SAO PAULO", label: "são paulo, SP" });
  assert.deepEqual(resolveBrPlace({ town: "Santa Cruz", area: "RN" }, index), { area: "RN:SANTA CRUZ", label: "Santa Cruz, RN" });
  assert.equal(resolveBrPlace({ town: "Atlantis" }, index), null);
  assert.throws(() => resolveBrPlace({ town: "Santa Cruz" }, index), /several states \(RN, RS\)/);
  assert.throws(() => resolveBrPlace({ area: "Atlantis" }, index), /Unknown Brazilian state/);
  assert.throws(() => resolveBrPlace({ postcode: "01310-100" }, index), /CEP/);
  assert.equal(brHistoryKey({ area: "SP", fuel: "lpg" }), null);
  assert.deepEqual(brHistoryKey({ area: "MG", fuel: "petrol95" }), { area: "MG", item: "petrol95", label: "Minas Gerais (state), Brazil" });
});

test("BR: the answer names the survey week, the sample, the unit and flags old data", () => {
  const row = { date: "2026-09-26", area: "SP:SAO PAULO", item: "petrol95", n: 88, median: 6.49, low: 6.19, high: 6.79, min: 5.99, max: 7.19 };
  const place = { area: "SP:SAO PAULO", label: "São Paulo, SP" };
  const a = brAnswerFromRow(row, { fuel: "petrol95", place, query: { country: "BR", town: "São Paulo", fuel: "petrol95" }, libraryDate: "2026-09-26", now: "2026-10-14" });
  assert.equal(a.status, "ok");
  assert.equal(a.price_type, "posted_pump_price");
  assert.equal(a.price!.currency, "BRL");
  assert.equal(a.price!.unit, "per litre");
  assert.equal(a.price!.median, 6.49);
  assert.equal(a.sample_size, 88);
  assert.equal(a.confidence, "high");
  assert.deepEqual(a.period, { from: "2026-09-20", to: "2026-09-26" });
  assert.match(a.summary, /Regular petrol \(gasolina comum\) in São Paulo, SP/);
  assert.match(a.summary, /survey of the week ending 2026-09-26/);
  assert.doesNotMatch(a.summary, /old data/);
  // posted prices are never described as what people pay; tax status and range definition are stated
  assert.match(a.summary, /typical range \(10th–90th percentile\) .* across the surveyed stations \(posted pump prices, taxes included\)\./);
  assert.doesNotMatch(a.summary, /\b(costs?|paid|pays?)\b/i);
  assert.equal((a.extra as any).data_age_days, 18);
  assert.equal((a.extra as any).coverage, "surveyed_stations_only");
  assert.match(a.source.licence, /Decreto 8\.777\/2016/);
  // 40 days old: flagged in the summary and in extra
  const old = brAnswerFromRow(row, { fuel: "petrol95", place, query: {}, libraryDate: "2026-09-26", now: "2026-11-05" });
  assert.match(old.summary, /This is old data: 40 days/);
  assert.match(String((old.extra as any).stale_warning), /ended 40 days ago/);
  // a place whose newest row is older than the library's newest day says so
  const behind = brAnswerFromRow({ ...row, date: "2026-09-12" }, { fuel: "diesel", place, query: {}, libraryDate: "2026-09-26", now: "2026-09-27" });
  assert.match(String((behind.extra as any).note), /fewer than 5 surveyed stations in the newest week \(2026-09-26\); the figure is from 2026-09-12/);
  assert.match(behind.summary, /Diesel S10/);
});

test("BR: end to end from a library: found, unknown municipality, too small, and a fuel Brazil does not publish", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "br-lib-"));
  const saved = process.env.PROOFPRICE_LIBRARY_DIR;
  process.env.PROOFPRICE_LIBRARY_DIR = dir;
  try {
    const day = brDailyRows([...parseAnpCsv(gasCsv), ...parseAnpCsv(dieCsv)]);
    const { rows } = writeDaily("br-fuel", day);
    writeMeta("br-fuel", {
      source: "br-fuel", currency: "BRL", unit: "per litre", first_date: day.date, last_date: day.date, days: 1,
      last_harvest_at: "2026-10-14T03:30:00.000Z", last_rows: rows, last_ok_at: "2026-10-14T03:30:00.000Z", last_error: null, note: day.note,
    });
    const ok = await brFuelNow({ town: "Salvador", fuel: "petrol95" });
    assert.equal(ok.status, "ok");
    assert.equal(ok.sample_size, 6);
    assert.equal(ok.price!.median, 6.335);
    assert.match(ok.summary, /Salvador, BA/);
    const state = await brFuelNow({ area: "Bahia", fuel: "petrol95" });
    assert.equal(state.sample_size, 11);
    assert.match(state.summary, /Bahia \(state\)/);
    const all = await brFuelNow({ fuel: "diesel" });
    assert.equal(all.sample_size, 21);
    const none = await brFuelNow({ town: "Jacobina", area: "BA", fuel: "petrol95" }); // 2 surveyed stations: below the minimum
    assert.equal(none.status, "no_matches");
    assert.equal(none.price, null);
    assert.match(String((none.extra as any).note), /fewer than 5 surveyed stations/);
    const unknown = await brFuelNow({ town: "Atlantis", fuel: "petrol95" });
    assert.equal(unknown.status, "no_matches");
    await assert.rejects(brFuelNow({ town: "Salvador", fuel: "lpg" }), /petrol95/);
    // the history key reads the same library
    assert.deepEqual(brHistoryKey({ town: "Salvador", fuel: "petrol95" }), { area: "BA:SALVADOR", item: "petrol95", label: "Salvador, BA, Brazil" });
  } finally {
    if (saved === undefined) delete process.env.PROOFPRICE_LIBRARY_DIR;
    else process.env.PROOFPRICE_LIBRARY_DIR = saved;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("BR: the collector reads the two newest monthly files of each group and skips a month that is not published yet", async () => {
  assert.equal(anpFileUrl(2026, 9, "gasolina-etanol"), "https://www.gov.br/anp/pt-br/centrais-de-conteudo/dados-abertos/arquivos/shpc/dsan/2026/09-dados-abertos-precos-2026-09-gasolina-etanol.csv");
  assert.deepEqual(candidateMonths(new Date("2026-01-10T00:00:00Z")), [{ year: 2026, month: 1 }, { year: 2025, month: 12 }, { year: 2025, month: 11 }]);
  const realFetch = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = (async (u: any) => {
    const url = String(u);
    urls.push(url);
    if (url.includes("/2026/10-")) return new Response("{}", { status: 404 }); // October is not published yet
    return new Response(url.includes("gasolina-etanol") ? gasCsv : dieCsv, { status: 200 });
  }) as typeof fetch;
  try {
    const day = await brHarvest(new Date("2026-10-14T03:17:00Z"));
    assert.equal(urls.filter((u) => u.includes("gasolina-etanol")).length, 3); // Oct (404), Sep, Aug
    assert.equal(urls.filter((u) => u.includes("diesel-gnv")).length, 3);
    assert.equal(day.date, "2026-09-01");
    // the same rows arrive from two files (September and August stubs are identical): one price per station
    assert.equal(day.rows.find((r) => r.area === "ALL" && r.item === "petrol95")!.n, 12);
  } finally {
    globalThis.fetch = realFetch;
  }
  globalThis.fetch = (async () => new Response("{}", { status: 404 })) as typeof fetch;
  try {
    await assert.rejects(brHarvest(new Date("2026-10-14T03:17:00Z")), /No ANP monthly file found/);
  } finally {
    globalThis.fetch = realFetch;
  }
});
