FROM node:22-bookworm-slim
ENV container=docker
RUN apt-get update && apt-get install -y --no-install-recommends systemd systemd-sysv libpam-systemd dbus dbus-user-session sudo procps ca-certificates curl git \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 1001 --shell /bin/bash talos \
    && printf 'talos ALL=(ALL) NOPASSWD: ALL\n' > /etc/sudoers.d/talos-e2e \
    && chmod 0440 /etc/sudoers.d/talos-e2e \
    && systemctl mask systemd-networkd.service systemd-networkd.socket systemd-resolved.service \
    && mkdir -p /home/talos/.local/bin /artifacts \
    && chown -R talos:talos /home/talos /artifacts
STOPSIGNAL SIGRTMIN+3
CMD ["/sbin/init"]
