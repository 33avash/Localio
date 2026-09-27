# Ward boundaries and ward metadata

Vendored from [datameet/Pune_wards](https://github.com/datameet/Pune_wards) at commit `0eb4fc7568cd6fd67dc63ca7da3426fe86af6b0a`, retrieved 2026-09-26.

| File | What it is |
|---|---|
| `pune-electoral-wards.geojson` | 76 Pune Municipal Corporation electoral wards, 2012 delimitation, scraped by DataMeet from the State Election Commission's map |
| `pcmc-electoral-wards.geojson` | 66 Pimpri-Chinchwad Municipal Corporation electoral wards, from Shelter Associates' spatial slum information maps |
| `pune-wards-info.csv` | PMC ward titles, admin wards, and 2012 electoral roll counts (`voters`) |
| `pune-admin-ward-offices.csv` | PMC's 15 admin ward offices and the electoral wards under each |

**Licence:** [Creative Commons Attribution-ShareAlike 2.5 India](https://creativecommons.org/licenses/by-sa/2.5/in/), © DataMeet Trust (Pune chapter). Share-alike applies to these files and to data derived from them. Localio's ward-level outputs carry the same licence, and this repository's MIT licence covers its code only; see [DATA_LICENSES.md](../../DATA_LICENSES.md).

**Known limits:**
- These are the 2012 wards. PMC redrew them in 2017 and absorbed 34 villages in 2017–2021, so outlets in those villages fall outside every ward and are counted as outside.
- DataMeet has no Census population per ward. Localio builds one; see `seed_data/ward_population.csv`.
