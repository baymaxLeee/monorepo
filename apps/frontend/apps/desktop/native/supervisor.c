// Seatbelt is inherited even when a command changes its session/process group.
// Give each command an unguessable policy marker and query that policy to find
// its descendants. Parent-death monitoring does not depend on Electron cleanup.
// sandbox_check SPI is also declared by WebKit's SandboxSPI.h; startup probes
// must fail closed on macOS releases where these operations are unavailable.
#include <sys/event.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <libproc.h>
#include <dlfcn.h>
#include <errno.h>
#include <fcntl.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

typedef int (*check_fn)(pid_t, const char *, int, ...);
typedef int (*init_fn)(const char *, unsigned long long, const char *const *, char **);
static check_fn check_policy;
static int filter;
static const char *marker;
static int owned(pid_t pid) {
  if (pid == getpid()) return 0;
  return check_policy(pid, "mach-lookup", filter, marker) == 0 &&
    check_policy(pid, "mach-lookup", filter, "com.monorepo.desktop.forbidden") == 1;
}
static int stop_owned(void) {
  int capacity = proc_listallpids(NULL, 0) + 256;
  if (capacity <= 256) return -1;
  pid_t *pids = calloc((size_t)capacity, sizeof(pid_t));
  if (!pids) return -1;
  int n = proc_listallpids(pids, capacity * (int)sizeof(pid_t));
  if (n <= 0 || n >= capacity) { free(pids); return -1; }
  int remaining = 0;
  for (int i = 0; i < n; i++) {
    struct proc_bsdinfo info;
    if (proc_pidinfo(pids[i], PROC_PIDTBSDINFO, 0, &info, sizeof(info)) != sizeof(info) || info.pbi_uid != getuid()) continue;
    if (owned(pids[i])) { remaining++; kill(pids[i], SIGKILL); }
  }
  free(pids);
  return remaining;
}
int main(int argc, char **argv) {
  if (argc < 4) return 64; // marker, profile, executable, arguments
  marker = argv[1];
  void *library = dlopen("/usr/lib/libsandbox.dylib", RTLD_NOW);
  if (!library) { fputs("libsandbox unavailable\n", stderr); return 70; }
  check_policy = (check_fn)dlsym(library, "sandbox_check");
  init_fn apply = (init_fn)dlsym(library, "sandbox_init_with_parameters");
  const int *no_report = dlsym(library, "SANDBOX_CHECK_NO_REPORT");
  if (!check_policy || !apply || !no_report) { fprintf(stderr, "sandbox API unavailable: %d %d %d\n", !!check_policy, !!apply, !!no_report); return 70; }
  filter = 2 | *no_report; // SANDBOX_FILTER_GLOBAL_NAME
  signal(SIGPIPE, SIG_IGN);
  int queue = kqueue(), gate[2], ready[2], input[2];
  if (queue < 0 || pipe(gate) || pipe(ready) || pipe(input)) return 70;
  fcntl(queue, F_SETFD, FD_CLOEXEC);
  pid_t parent = getppid(), child = fork();
  if (child < 0) return 70;
  if (!child) {
    close(gate[1]); close(ready[0]); close(input[1]); close(queue);
    char *error = NULL;
    if (apply(argv[2], 0, NULL, &error)) { if (error) fputs(error, stderr); _exit(70); }
    if (write(ready[1], "x", 1) != 1) _exit(70);
    close(ready[1]);
    char byte;
    if (read(gate[0], &byte, 1) != 1) _exit(70);
    close(gate[0]);
    if (dup2(input[0], STDIN_FILENO) < 0) _exit(70);
    close(input[0]);
    execv(argv[3], &argv[3]);
    _exit(127);
  }
  close(gate[0]); close(ready[1]); close(input[0]);
  char byte;
  if (read(ready[0], &byte, 1) != 1 || !owned(child) || getppid() != parent) {
    fprintf(stderr, "policy identity probe failed: %d %d\n", check_policy(child, "mach-lookup", filter, marker), check_policy(child, "mach-lookup", filter, "com.monorepo.desktop.forbidden")); kill(child, SIGKILL); close(gate[1]); waitpid(child, NULL, 0); return 70;
  }
  close(ready[0]);
  struct kevent changes[3];
  EV_SET(&changes[0], child, EVFILT_PROC, EV_ADD, NOTE_EXIT, 0, NULL);
  EV_SET(&changes[1], parent, EVFILT_PROC, EV_ADD, NOTE_EXIT, 0, NULL);
  EV_SET(&changes[2], STDIN_FILENO, EVFILT_READ, EV_ADD, 0, 0, NULL);
  if (kevent(queue, changes, 3, NULL, 0, NULL) < 0) { perror("kevent"); kill(child, SIGKILL); return 70; }
  if (write(gate[1], "x", 1) != 1) { kill(child, SIGKILL); return 70; }
  close(gate[1]);
  int stopping = 0, leader_done = 0, status = 0, empty_scans = 0;
  for (;;) {
    struct kevent events[8];
    struct timespec interval = { .tv_sec = 0, .tv_nsec = 20000000 };
    int n = kevent(queue, NULL, 0, events, 8, &interval);
    if (n < 0 && errno == EINTR) continue;
    if (n < 0) stopping = 1;
    for (int i = 0; i < n; i++) {
      struct kevent e = events[i];
      if (e.flags & EV_ERROR) stopping = 1;
      if (e.filter == EVFILT_READ) {
        char buffer[16384];
        ssize_t size = read(STDIN_FILENO, buffer, sizeof(buffer));
        if (size <= 0) {
          stopping = 1;
          EV_SET(&changes[0], STDIN_FILENO, EVFILT_READ, EV_DELETE, 0, 0, NULL);
          kevent(queue, changes, 1, NULL, 0, NULL);
        } else if (!stopping) {
          ssize_t offset = 0;
          while (offset < size) {
            ssize_t written = write(input[1], buffer + offset, (size_t)(size - offset));
            if (written <= 0) break;
            offset += written;
          }
        }
      } else if (e.filter == EVFILT_PROC && (e.fflags & NOTE_EXIT)) {
        stopping = 1;
        if ((pid_t)e.ident == child) { waitpid(child, &status, 0); leader_done = 1; }
      }
    }
    if (stopping) {
      if (!leader_done) kill(child, SIGKILL);
      int remaining = stop_owned();
      empty_scans = remaining == 0 ? empty_scans + 1 : 0;
      if (leader_done && empty_scans >= 2) break;
    }
  }
  close(input[1]); close(queue);
  return WIFEXITED(status) ? WEXITSTATUS(status) : 128 + WTERMSIG(status);
}
