# PCB stencils — reference

The client's `Formatted Output` drop (2026-08-10) contains `stencils.csv`: 43 rows tracking which
**PCB stencils exist for which board, in which versions**.

**It is not stock, and it is not in the database.** The client's own `Import_Guide.md` says so:

> `stencils.csv` is the one exception — it's PCB project/version tracking, not a parts list, so it
> has no `MPN`/`Distributor`/`LCSC_Part`/`Qty_In_Stock` (nothing in the source maps to those
> concepts there).

Importing it into `smark_parts` would put 43 rows with no part number, no distributor and a
permanently-zero quantity into Inventory, and 43 entries into the Receive onboarding queue that
nobody can ever put on a shelf. So the data is preserved here instead, verbatim, and the question of
where it should really live — its own small surface, a field on `smark_projects`, or nowhere — is
open for Krunal Sir to decide.

Source: `tests/fixtures/formatted-output/stencils.csv` (sheet `S12-Stencils`).

## Reading this table

Rows marked **\*** had a blank `Project` cell in the CSV. In the original spreadsheet that column
used merged cells, so a blank means "same project as the row above" — this table carries the name
down. That is an inference from the row order and the board names, not something the file states.
**Worth a glance from Krunal Sir**; if any board belongs to a different project, the CSV row number
is in the last column.

| Project | Board | Stencil versions | Source row |
|---|---|---|---:|
| Power Breezer | MCB | V2, V2.1, V2.2, V2.3, V2.41, V2.41_Internal | 6 |
| Power Breezer \* | WiFi_Module_Board | V1, V3 | 7 |
| Power Breezer \* | FCB | V1, V2.1, V2.2, V2.3, V2.4, V2.4_Internal | 8 |
| Power Breezer \* | CP | V1.3, V2.3 | 9 |
| Power Breezer \* | PRB | — | 10 |
| Power Breezer \* | TH_Sensor | V2 | 11 |
| Power Breezer \* | VoltageDivider (STANDARD & MAX) | — | 12 |
| Power Breezer \* | Sky2_RS485_Converter | FT232RL, CH340B, CP2102 | 13 |
| Power Breezer \* | WBOMAN9321C | — | 14 |
| IR_RGB | IRRemoteControl | V5, V6 | 16 |
| IR_RGB \* | White_Only | — | 17 |
| IR_RGB \* | MainBoard-NoMicro | — | 18 |
| IR_RGB \* | Bluetooth Speaker | V1 | 19 |
| IR_RGB \* | WS2812B | — | 20 |
| IR_RGB \* | White_LED PCB | — | 21 |
| UK | TempLogger (DAQ) | V1, V1.2 | 23 |
| Heacol | Main_Board | V1 | 24 |
| Heacol \* | LCD_Screen | — | 25 |
| Imatrack | Imatrack PIC uC | — | 28 |
| Imatrack \* | Camera Board | — | 29 |
| IndiaOne | MainBoard | V2, V3 | 31 |
| IndiaOne \* | Camera_Board | V2, V3 | 32 |
| IndiaOne \* | Ethernet_Board | V1, V2 | 33 |
| SolTrack | SolTrack (2 Stencils) | V, V4 | 35 |
| SolTrack \* | Photo Sensor (3 Stencils) | — | 36 |
| SolTrack \* | SolTrack_PV_Mega2560 | — | 37 |
| SolTrack \* | SolTrack_PV_STM | — | 38 |
| SolTrack \* | SolTrack_STM | V1 | 39 |
| SolTrack \* | YM23_BLEModule | — | 40 |
| VSS | Master | — | 42 |
| VSS \* | AC Slave | — | 43 |
| VSS \* | DC Slave | — | 44 |
| Durotek | Weapon Simulation System Receiver | — | 47 |
| Durotek \* | 3 Barrel PCB | — | 48 |
| Green House Sensor | GHC_Gateway | — | 50 |
| Green House Sensor \* | Sensor_Nodes | — | 51 |
| Slouchless | Slouchless_Device | — | 53 |
| Swadeshi Processor | Swadeshi_uP_Challenge_V2 | — | 55 |
| Traffic Controller | Master_V2 | 2.1 | 57 |
| Traffic Controller \* | Slave_V2 | 2.1 | 58 |
| SMDAS (DataLogger) | SMDAS-08K08A_V1 | — | 60 |
| SMDAS (DataLogger) \* | SMDAS_EthernetBoard | — | 61 |
| SMDAS (DataLogger) \* | SMDAS_WiFi | — | 62 |

14 projects, 43 boards. A blank version column means the source listed a stencil for the board
without recording which revision it cuts.
