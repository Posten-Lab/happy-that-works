FROM node:22-alpine
RUN apk add --no-cache openrc sudo procps curl bash git \
    && adduser -D -u 1001 -s /bin/bash talos \
    && printf 'talos ALL=(ALL) NOPASSWD: ALL\n' > /etc/sudoers.d/talos-e2e \
    && chmod 0440 /etc/sudoers.d/talos-e2e \
    && sed -i 's/^#rc_sys=""/rc_sys="docker"/' /etc/rc.conf \
    && printf '\nrc_cgroup_mode="none"\n' >> /etc/rc.conf \
    && mkdir -p /home/talos/.local/bin /artifacts \
    && chown -R talos:talos /home/talos /artifacts
COPY linux-openrc-init.sh /usr/local/sbin/talos-openrc-init
RUN chmod 0755 /usr/local/sbin/talos-openrc-init
CMD ["/usr/local/sbin/talos-openrc-init"]
