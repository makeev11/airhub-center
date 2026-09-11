import { useCommunities } from "@/features/communities/useCommunities";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  addRelayMember,
  changeRelayMemberRole,
  getMyRelayMembership,
  getMyRelayMembershipLookup,
  listRelayMembers,
  removeRelayMember,
} from "@/shared/api/relayMembers";
import type { RelayMember } from "@/shared/api/types";

export const relayMembersQueryKey = ["relayMembers"] as const;
export const myRelayMembershipQueryKey = ["myRelayMembership"] as const;
export const myRelayMembershipLookupQueryKey = [
  "myRelayMembershipLookup",
] as const;

export function useRelayMembersQuery(enabled = true) {
  const scope = useMembershipScope();
  return useQuery({
    enabled,
    queryKey: [...relayMembersQueryKey, ...scope],
    queryFn: listRelayMembers,
    staleTime: 30_000,
  });
}

export function useMyRelayMembershipQuery() {
  const scope = useMembershipScope();
  return useQuery({
    queryKey: [...myRelayMembershipQueryKey, ...scope],
    queryFn: getMyRelayMembership,
    staleTime: 60_000,
  });
}

export function useMyRelayMembershipLookupQuery() {
  const scope = useMembershipScope();
  return useQuery({
    queryKey: [...myRelayMembershipLookupQueryKey, ...scope],
    queryFn: getMyRelayMembershipLookup,
    staleTime: 60_000,
  });
}

export function useAddRelayMemberMutation() {
  const scope = useMembershipScope();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ pubkey, role }: { pubkey: string; role: string }) =>
      addRelayMember(pubkey, role),
    onMutate: async ({ pubkey, role }) => {
      await queryClient.cancelQueries({
        queryKey: [...relayMembersQueryKey, ...scope],
      });
      const previous = queryClient.getQueryData<RelayMember[]>([
        ...relayMembersQueryKey,
        ...scope,
      ]);

      queryClient.setQueryData<RelayMember[]>(
        [...relayMembersQueryKey, ...scope],
        (old) => [
          ...(old ?? []),
          {
            pubkey,
            role: role as RelayMember["role"],
            addedBy: null,
            createdAt: new Date().toISOString(),
          },
        ],
      );

      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(
          [...relayMembersQueryKey, ...scope],
          context.previous,
        );
      }
    },
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: [...relayMembersQueryKey, ...scope],
        }),
        queryClient.invalidateQueries({
          queryKey: [...myRelayMembershipQueryKey, ...scope],
        }),
        queryClient.invalidateQueries({
          queryKey: [...myRelayMembershipLookupQueryKey, ...scope],
        }),
      ]);
    },
  });
}

export function useRemoveRelayMemberMutation() {
  const scope = useMembershipScope();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (pubkey: string) => removeRelayMember(pubkey),
    onMutate: async (pubkey) => {
      await queryClient.cancelQueries({
        queryKey: [...relayMembersQueryKey, ...scope],
      });
      const previous = queryClient.getQueryData<RelayMember[]>([
        ...relayMembersQueryKey,
        ...scope,
      ]);

      queryClient.setQueryData<RelayMember[]>(
        [...relayMembersQueryKey, ...scope],
        (old) =>
          old?.filter((m) => m.pubkey.toLowerCase() !== pubkey.toLowerCase()),
      );

      return { previous };
    },
    onError: (_err, _pubkey, context) => {
      if (context?.previous) {
        queryClient.setQueryData(
          [...relayMembersQueryKey, ...scope],
          context.previous,
        );
      }
    },
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: [...relayMembersQueryKey, ...scope],
        }),
        queryClient.invalidateQueries({
          queryKey: [...myRelayMembershipQueryKey, ...scope],
        }),
        queryClient.invalidateQueries({
          queryKey: [...myRelayMembershipLookupQueryKey, ...scope],
        }),
      ]);
    },
  });
}

export function useChangeRelayMemberRoleMutation() {
  const scope = useMembershipScope();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      pubkey,
      role,
      newRole,
    }: {
      pubkey: string;
      role?: string;
      newRole?: string;
    }) => changeRelayMemberRole(pubkey, role ?? newRole ?? "member"),
    onMutate: async ({ pubkey, role, newRole }) => {
      const nextRole = (role ?? newRole ?? "member") as RelayMember["role"];
      await queryClient.cancelQueries({
        queryKey: [...relayMembersQueryKey, ...scope],
      });
      const previous = queryClient.getQueryData<RelayMember[]>([
        ...relayMembersQueryKey,
        ...scope,
      ]);

      queryClient.setQueryData<RelayMember[]>(
        [...relayMembersQueryKey, ...scope],
        (old) =>
          old?.map((m) =>
            m.pubkey.toLowerCase() === pubkey.toLowerCase()
              ? { ...m, role: nextRole }
              : m,
          ),
      );

      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(
          [...relayMembersQueryKey, ...scope],
          context.previous,
        );
      }
    },
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: [...relayMembersQueryKey, ...scope],
        }),
        queryClient.invalidateQueries({
          queryKey: [...myRelayMembershipQueryKey, ...scope],
        }),
        queryClient.invalidateQueries({
          queryKey: [...myRelayMembershipLookupQueryKey, ...scope],
        }),
      ]);
    },
  });
}

function useMembershipScope() {
  const { activeCommunity } = useCommunities();
  return [
    activeCommunity?.id,
    activeCommunity?.relayUrl,
    activeCommunity?.pubkey,
  ];
}
