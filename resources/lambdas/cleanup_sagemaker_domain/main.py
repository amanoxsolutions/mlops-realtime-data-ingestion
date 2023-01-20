import os
import boto3
import logging
import lib.cfnresponse as cfnresponse
from typing import Dict, List, Tuple

logger = logging.getLogger()
logger.setLevel(logging.INFO)
sagemaker = boto3.client("sagemaker")
efs = boto3.client("efs")
ec2 = boto3.resource('ec2')
ec2_client = boto3.client('ec2')

SAGEMAKER_DOMAIN_ID = os.environ["SAGEMAKER_DOMAIN_ID"]
PHYSICAL_ID = os.environ["PHYSICAL_ID"]

def lambda_handler(event, context):
    try:
        request = event.get("RequestType").lower()
        logger.info(f"Type of request: {request}")
        if request == "delete":
            # Get the EFS ID of the SageMaker domain
            efs_id = get_sagemaker_domain_efs(SAGEMAKER_DOMAIN_ID)
            # Delete the EFS
            delete_efs(efs_id)
    except Exception as e:
        logger.exception(e)
        cfnresponse.send(event, context, cfnresponse.FAILED, {}, physicalResourceId=PHYSICAL_ID)
    else:
        cfnresponse.send(event, context, cfnresponse.SUCCESS, {}, physicalResourceId=PHYSICAL_ID)


def get_sagemaker_domain_efs(domain_id: str) -> str:
    """Get the EFS ID of the SageMaker domain

    Args:
        domain_id (str): the SageMaker domain ID

    Returns:
        str: the EFS ID of the SageMaker domain
    """
    # Describe the sagemaker domain and extract the EFS ID from it
    logger.info(f"Cleaning up EFS for SageMaker domain {domain_id}")
    response = sagemaker.describe_domain(DomainIdEquals=domain_id)
    efs_id = response.get("HomeEfsFileSystemId")
    logger.info(f"The EFS ID of the SageMaker domain {domain_id} is {efs_id}")
    return efs_id


def delete_efs(efs_id: str) -> None:
    """Delete the EFS mount target and the file system.

    Args:
        efs_id (str): the EFS ID
    """
    # Get the mount targets of the EFS file system and delete them
    response = efs.describe_mount_targets(FileSystemId=efs_id)
    mount_targets = response.get("MountTargets")
    logger.info(f"Found {len(mount_targets)} mount targets for the EFS file system {efs_id}: {mount_targets}")
    # Get the Network Inerface IDs of the mount targets and delete them
    eni_ids = []
    for mount_target in mount_targets:
        mount_target_id = mount_target.get("MountTargetId")
        eni_id = mount_target.get("NetworkInterfaceId")
        eni_ids.append(eni_id)
        logger.info(f"Deleting EFS file system {efs_id} mount target {mount_target_id}")
        efs.delete_mount_target(MountTargetId=mount_target_id)
    logger.info(f"Found {len(eni_ids)} ENIs for the EFS file system {efs_id}: {eni_ids}")
    # For all all ENIs, get their Network Security Groups
    for eni_id in eni_ids:
        eni = ec2.NetworkInterface(eni_id)
        logger.info(f"Cleaning up ENI {eni_id}")
        eni_nsgs = eni.groups
        logger.info(f"Found {len(eni_nsgs)} Network Security Groups for the ENI {eni_id}: {eni_nsgs}")
        # For all Network Security Groups, remove all the rules
        for eni_nsg in eni_nsgs:
            nsg_id = eni_nsg.get("GroupId")
            nsg = ec2.SecurityGroup(nsg_id)
            if nsg.ip_permissions:
                logger.info(f"Removing all ingress rules from Network Security Group {nsg.ip_permissions}")
                nsg.revoke_ingress(IpPermissions=nsg.ip_permissions)
            if nsg.ip_permissions_egress:
                logger.info(f"Removing all egress rules from Network Security Group {nsg.ip_permissions_egress}")
                nsg.revoke_egress(IpPermissions=nsg.ip_permissions_egress)
            # List all the other NSGs and check if they reference the EFS NSG
            # If they do, delete the rule with the reference
            all_nsgs = ec2_client.describe_security_groups()
            for nsg_details in all_nsgs.get("SecurityGroups", []):
                other_nsg_id = nsg_details.get("GroupId")
                if nsg_id != other_nsg_id:
                    other_nsg = ec2.SecurityGroup(other_nsg_id)
                    logger.info(f"Checking Network Security Group {other_nsg_id} for references to the EFS NSG {nsg_id}")
                    if other_nsg.ip_permissions:
                        for ip_permission in other_nsg.ip_permissions:
                            for user_id_group_pair in ip_permission.get("UserIdGroupPairs", []):
                                if user_id_group_pair.get("GroupId") == nsg_id:
                                    logger.info(f"Found references to the EFS NSG {nsg_id} in Network Security Group {other_nsg_id} ingress rules")
                                    logger.info(f"Removing references to the EFS NSG {nsg_id} in Network Security Group {other_nsg_id} ingress rules")
                                    other_nsg.revoke_ingress(IpPermissions=[ip_permission])
                    if other_nsg.ip_permissions_egress:
                        for ip_permission in other_nsg.ip_permissions_egress:
                            for user_id_group_pair in ip_permission.get("UserIdGroupPairs", []):
                                if user_id_group_pair.get("GroupId") == nsg_id:
                                    logger.info(f"Found references to the EFS NSG {nsg_id} in Network Security Group {other_nsg_id} egress rules")
                                    logger.info(f"Removing references to the EFS NSG {nsg_id} in Network Security Group {other_nsg_id} egress rules")
                                    other_nsg.revoke_egress(IpPermissions=[ip_permission])
        # Once all NSGs are empty of any cross reference, we can delete them
        for eni_nsg in eni_nsgs:
            nsg_id = eni_nsg.get("GroupId")
            logger.info(f"Deleting Network Security Group {nsg_id}")
            nsg.delete()
        # Delete the ENI
        logger.info(f"Deleting ENI {eni_id}")
        eni.delete()
    # Delete the EFS file system
    logger.info(f"Deleting EFS file system {efs_id}")
    efs.delete_file_system(FileSystemId=efs_id)
