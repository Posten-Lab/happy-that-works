# Talos CLI 1.0.20

Fixes repeated Muse recovery warnings when Muse 1.3 loses its loaded pending-request projection during an otherwise running turn. Talos now reads pending approvals and questions through its separate recovery observer, while retaining guarded decisions on the active Muse process. Repeated recovery failures emit one warning per outage while retries continue.

Includes the regression and real-Muse validation documented in [Muse pending recovery](../research/evidence/muse-pending-recovery/README.md). The wire dependency remains 0.1.7.
